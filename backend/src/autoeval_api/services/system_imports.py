from __future__ import annotations

import json
import re
from collections import deque
from typing import Any
from urllib.parse import quote, unquote, urlsplit, urlunsplit

import httpx
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from autoeval_api.agent_systems.registry import system_plugins
from autoeval_api.graph.definition import AgentGraphDefinition
from autoeval_api.graph.registry import NodeHandlerRegistry
from autoeval_api.graph.runtime_inputs import RuntimeInputCapabilityRegistry
from autoeval_api.graph.topology import topological_sequence
from autoeval_api.models import (
    AgentSystemRecord,
    AgentSystemVersionRecord,
    DatasetRecord,
    DatasetStatus,
    DatasetVersionRecord,
    PromptRecord,
    PromptVersionRecord,
)
from autoeval_api.services.scoring import IMPORTED_DATASET_PREFIX
from autoeval_api.services.versioning import (
    hash_json,
    hash_text,
    validate_graph_resource_policies,
)
from autoeval_api.system_import_schemas import (
    AutoEvalManifest,
    ImportSource,
    SystemImportCommitRequest,
    SystemImportCompatibility,
    SystemImportCounts,
    SystemImportPreview,
    SystemImportResult,
)

MAX_MANIFEST_BYTES = 512 * 1024
GITHUB_TIMEOUT_SECONDS = 8.0
GITHUB_PART = re.compile(r"^[A-Za-z0-9_.-]+$")


class SystemImportFetchError(ValueError):
    pass


class SystemImportConflictError(ValueError):
    pass


class SystemImportService:
    def __init__(
        self,
        node_registry: NodeHandlerRegistry,
        runtime_input_registry: RuntimeInputCapabilityRegistry | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.node_registry = node_registry
        self.runtime_input_registry = runtime_input_registry or RuntimeInputCapabilityRegistry()
        self.transport = transport

    async def inspect_github(self, session: Session, github_url: str) -> SystemImportPreview:
        manifest, source = await self._load_github_manifest(github_url)
        return self.inspect_manifest(session, manifest, source)

    def inspect_manifest(
        self,
        session: Session,
        manifest: AutoEvalManifest,
        source: ImportSource | None = None,
    ) -> SystemImportPreview:
        source = source or ImportSource(kind="local")
        system = session.query(AgentSystemRecord).filter_by(key=manifest.system.key).one_or_none()
        self._validate_manifest(session, manifest, system)
        graph_version = self._next_graph_version(session, system)
        prompt, prompt_version = self._primary_prompt_state(session, manifest.system.key, system)
        matching_graph = self._existing_graph(
            session,
            system,
            hash_json(manifest.graph.model_dump(mode="json")),
        )
        matching_prompt = self._existing_prompt_version(
            session,
            prompt,
            hash_text(manifest.prompt.content.strip()),
        )
        warnings = self._warnings(session, manifest, system, prompt)
        handlers = self.node_registry.effective_handler_names(manifest.system.key)
        return SystemImportPreview(
            digest=manifest_digest(manifest),
            manifest=manifest,
            source=source,
            warnings=warnings,
            existing_system_id=system.id if system else None,
            next_graph_version=graph_version,
            next_prompt_version=prompt_version,
            target_graph_version=(
                matching_graph.version if matching_graph is not None else graph_version
            ),
            target_prompt_version=(
                matching_prompt.version if matching_prompt is not None else prompt_version
            ),
            graph_version_created=matching_graph is None,
            prompt_version_created=matching_prompt is None,
            creates_system=system is None,
            counts=SystemImportCounts(
                nodes=len(manifest.graph.nodes),
                edges=len(manifest.graph.edges),
                llm_nodes=sum(node.kind == "llm" for node in manifest.graph.nodes),
                deterministic_nodes=sum(
                    node.kind == "deterministic" for node in manifest.graph.nodes
                ),
            ),
            compatibility=SystemImportCompatibility(
                runnable=True,
                evaluation_scoring=(
                    "registered"
                    if system is not None and manifest.system.key in system_plugins()
                    else "exact_json"
                ),
                handlers=[
                    *(f"deterministic:{name}" for name in handlers["deterministic"]),
                    *(f"llm:{name}" for name in handlers["llm"]),
                ],
            ),
        )

    def commit(
        self,
        session: Session,
        request: SystemImportCommitRequest,
    ) -> SystemImportResult:
        manifest = request.manifest
        digest = manifest_digest(manifest)
        if digest != request.expected_digest:
            raise SystemImportConflictError(
                "Manifest changed after inspection. Inspect it again before importing."
            )
        if manifest.system.key != request.expected_system_key:
            raise SystemImportConflictError(
                "Agent system key changed after inspection. Inspect it again before importing."
            )

        system = session.query(AgentSystemRecord).filter_by(key=manifest.system.key).one_or_none()
        current_system_id = system.id if system is not None else None
        if current_system_id != request.expected_system_id:
            raise SystemImportConflictError(
                "Agent system state changed after inspection. Inspect it again before importing."
            )
        if self._next_graph_version(session, system) != request.expected_graph_version:
            raise SystemImportConflictError(
                "Graph version history changed after inspection. Inspect it again before importing."
            )
        _prompt, next_prompt_version = self._primary_prompt_state(
            session, manifest.system.key, system
        )
        if next_prompt_version != request.expected_prompt_version:
            raise SystemImportConflictError(
                "Prompt version history changed after inspection. "
                "Inspect it again before importing."
            )

        self._validate_manifest(session, manifest, system)
        payload = manifest.graph.model_dump(mode="json")
        graph_hash = hash_json(payload)
        prompt_content = manifest.prompt.content.strip()
        prompt_hash = hash_text(prompt_content)
        existing_graph = self._existing_graph(session, system, graph_hash)
        primary_prompt, _ = self._primary_prompt_state(session, manifest.system.key, system)
        existing_prompt_version = self._existing_prompt_version(
            session, primary_prompt, prompt_hash
        )
        if (
            system is not None
            and existing_graph is not None
            and existing_prompt_version is not None
        ):
            raise SystemImportConflictError(
                f"Nothing to import. Graph version {existing_graph.version} and prompt version "
                f"{existing_prompt_version.version} already contain this manifest."
            )

        created_system = system is None
        try:
            if system is None:
                system = AgentSystemRecord(
                    key=manifest.system.key,
                    name=manifest.system.name,
                    description=manifest.system.description,
                    input_template=manifest.system.input_template,
                    import_metadata={
                        "schema_version": manifest.schema_version,
                        "source": self._source_for_storage(request.source),
                    },
                )
                session.add(system)
                session.flush()

            primary_prompt = primary_prompt or PromptRecord(
                agent_system_id=system.id,
                key=primary_prompt_key(system.key),
                name=f"{system.name} system prompt",
                description="Primary prompt imported from autoeval.json.",
            )
            if primary_prompt.id is None:
                session.add(primary_prompt)
                session.flush()

            if existing_prompt_version is None:
                prompt_version = PromptVersionRecord(
                    prompt_id=primary_prompt.id,
                    version=request.expected_prompt_version,
                    content=prompt_content,
                    content_hash=prompt_hash,
                )
                session.add(prompt_version)
                prompt_created = True
            else:
                prompt_version = existing_prompt_version
                prompt_created = False

            if existing_graph is None:
                graph_version = AgentSystemVersionRecord(
                    agent_system_id=system.id,
                    version=request.expected_graph_version,
                    definition=payload,
                    content_hash=graph_hash,
                )
                session.add(graph_version)
                graph_created = True
            else:
                graph_version = existing_graph
                graph_created = False

            dataset: DatasetRecord | None = None
            dataset_version: DatasetVersionRecord | None = None
            if created_system:
                dataset = DatasetRecord(
                    agent_system_id=system.id,
                    key=imported_dataset_key(system.key),
                    name=f"{system.name} evaluations",
                    description="Examples and expected outputs for exact JSON evaluation.",
                )
                session.add(dataset)
                session.flush()
                dataset_version = DatasetVersionRecord(
                    dataset_id=dataset.id,
                    version=1,
                    status=DatasetStatus.DRAFT,
                )
                session.add(dataset_version)

            session.commit()
            for record in (system, graph_version, primary_prompt, prompt_version):
                session.refresh(record)
            if dataset is not None and dataset_version is not None:
                session.refresh(dataset)
                session.refresh(dataset_version)
        except (IntegrityError, ValueError):
            session.rollback()
            raise SystemImportConflictError(
                "Import collided with another version update. Inspect the manifest again."
            ) from None

        return SystemImportResult(
            agent_system_id=system.id,
            graph_version_id=graph_version.id,
            graph_version=graph_version.version,
            graph_version_created=graph_created,
            prompt_id=primary_prompt.id,
            prompt_version_id=prompt_version.id,
            prompt_version=prompt_version.version,
            prompt_version_created=prompt_created,
            dataset_id=dataset.id if dataset else None,
            dataset_version_id=dataset_version.id if dataset_version else None,
            created_system=created_system,
            digest=digest,
        )

    def _validate_manifest(
        self,
        session: Session,
        manifest: AutoEvalManifest,
        system: AgentSystemRecord | None,
    ) -> None:
        definition = manifest.graph
        if len(manifest.model_dump_json().encode()) > MAX_MANIFEST_BYTES:
            raise ValueError("autoeval.json must be 512 KiB or smaller")
        self.validate_graph(session, manifest.system.key, definition, system)

        allowed_prompt_keys = {primary_prompt_key(manifest.system.key)}
        if system is not None:
            allowed_prompt_keys.update(
                row.key
                for row in session.query(PromptRecord).filter_by(agent_system_id=system.id).all()
            )
        invalid = sorted(definition.prompt_keys() - allowed_prompt_keys)
        if invalid:
            raise ValueError(
                "Graph prompt keys are not available from this manifest: " + ", ".join(invalid)
            )

    def validate_graph(
        self,
        session: Session,
        system_key: str,
        definition: AgentGraphDefinition,
        system: AgentSystemRecord | None,
    ) -> None:
        """Use the same runnable-graph checks for imports and visual version edits."""
        definition.validate_references()
        topological_sequence(definition)
        self._validate_reachability(definition)
        self.node_registry.validate_definition(definition, system_key)
        self.runtime_input_registry.validate_definition(definition)
        if system_key not in system_plugins():
            self._validate_portable_topology(definition)
            for node in definition.nodes:
                if (
                    node.runtime_input_policy is not None
                    or node.snapshot_policy is not None
                    or node.resource_policy is not None
                ):
                    raise ValueError(
                        "Portable imports need a registered adapter for runtime input, "
                        "snapshot, or resource "
                        f"policies: {node.id}"
                    )
        if system is not None:
            validate_graph_resource_policies(session, system, definition)

    @staticmethod
    def _validate_reachability(definition: AgentGraphDefinition) -> None:
        outgoing: dict[str, list[str]] = {node.id: [] for node in definition.nodes}
        for edge in definition.edges:
            outgoing[edge.source].append(edge.target)
        if len({(edge.source, edge.target) for edge in definition.edges}) != len(definition.edges):
            raise ValueError("Graph edges must be unique")
        reached: set[str] = set()
        queue = deque([definition.entry_point])
        while queue:
            node_id = queue.popleft()
            if node_id in reached:
                continue
            reached.add(node_id)
            queue.extend(outgoing[node_id])
        missing = sorted(set(outgoing) - reached)
        if missing:
            raise ValueError(
                "Every graph node must be reachable from the entry point: " + ", ".join(missing)
            )
        if outgoing[definition.output_node]:
            raise ValueError("Graph output_node must be a sink node")

    @staticmethod
    def _validate_portable_topology(definition: AgentGraphDefinition) -> None:
        incoming = {node.id: 0 for node in definition.nodes}
        outgoing = {node.id: 0 for node in definition.nodes}
        for edge in definition.edges:
            incoming[edge.target] += 1
            outgoing[edge.source] += 1
        invalid = sorted(
            node.id for node in definition.nodes if incoming[node.id] > 1 or outgoing[node.id] > 1
        )
        sinks = [node_id for node_id, count in outgoing.items() if count == 0]
        if invalid or sinks != [definition.output_node]:
            raise ValueError("Portable graphs must use one sequential path ending at output_node")
        output = definition.node(definition.output_node)
        if output is None or output.kind != "deterministic" or output.handler != "output":
            raise ValueError("Portable graphs must finish with the deterministic output handler")

    @staticmethod
    def _warnings(
        session: Session,
        manifest: AutoEvalManifest,
        system: AgentSystemRecord | None,
        prompt: PromptRecord | None,
    ) -> list[str]:
        if system is None:
            return [
                "Imported datasets use exact whole-JSON matching until code registers "
                "custom scoring."
            ]
        warnings: list[str] = []
        if system.name != manifest.system.name or system.description != manifest.system.description:
            warnings.append("The existing system name and description will stay unchanged.")
        graph_hash = hash_json(manifest.graph.model_dump(mode="json"))
        duplicate_graph = SystemImportService._existing_graph(session, system, graph_hash)
        if duplicate_graph is not None:
            warnings.append(f"Graph version {duplicate_graph.version} will be reused.")
        prompt_hash = hash_text(manifest.prompt.content.strip())
        duplicate_prompt = SystemImportService._existing_prompt_version(
            session, prompt, prompt_hash
        )
        if duplicate_prompt is not None:
            warnings.append(f"Prompt version {duplicate_prompt.version} will be reused.")
        return warnings

    @staticmethod
    def _next_graph_version(session: Session, system: AgentSystemRecord | None) -> int:
        if system is None:
            return 1
        current = (
            session.query(func.max(AgentSystemVersionRecord.version))
            .filter_by(agent_system_id=system.id)
            .scalar()
            or 0
        )
        return current + 1

    @staticmethod
    def _primary_prompt_state(
        session: Session,
        system_key: str,
        system: AgentSystemRecord | None,
    ) -> tuple[PromptRecord | None, int]:
        if system is None:
            return None, 1
        prompt = (
            session.query(PromptRecord)
            .filter_by(agent_system_id=system.id, key=primary_prompt_key(system_key))
            .one_or_none()
        )
        if prompt is None:
            return None, 1
        current = (
            session.query(func.max(PromptVersionRecord.version))
            .filter_by(prompt_id=prompt.id)
            .scalar()
            or 0
        )
        return prompt, current + 1

    @staticmethod
    def _existing_graph(
        session: Session,
        system: AgentSystemRecord | None,
        content_hash: str,
    ) -> AgentSystemVersionRecord | None:
        if system is None:
            return None
        return (
            session.query(AgentSystemVersionRecord)
            .filter_by(agent_system_id=system.id, content_hash=content_hash)
            .one_or_none()
        )

    @staticmethod
    def _existing_prompt_version(
        session: Session,
        prompt: PromptRecord | None,
        content_hash: str,
    ) -> PromptVersionRecord | None:
        if prompt is None:
            return None
        return (
            session.query(PromptVersionRecord)
            .filter_by(prompt_id=prompt.id, content_hash=content_hash)
            .one_or_none()
        )

    # TODO: double check if this is safe to do
    async def _load_github_manifest(self, value: str) -> tuple[AutoEvalManifest, ImportSource]:
        owner, repo, ref, manifest_path, clean_url = parse_github_url(value)
        if ref is None:
            repo_url = f"https://api.github.com/repos/{quote(owner)}/{quote(repo)}"
            metadata = await self._fetch_json(repo_url, "GitHub repository")
            ref_value = metadata.get("default_branch")
            if not isinstance(ref_value, str) or not ref_value:
                raise SystemImportFetchError("GitHub did not return a default branch")
            ref = ref_value
        encoded_path = "/".join(quote(part, safe="") for part in manifest_path.split("/"))
        raw_url = (
            f"https://raw.githubusercontent.com/{quote(owner)}/{quote(repo)}/"
            f"{quote(ref, safe='')}/{encoded_path}"
        )
        body = await self._fetch_bytes(raw_url, "autoeval.json")
        try:
            decoded = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise SystemImportFetchError("GitHub autoeval.json is not valid JSON") from error
        try:
            manifest = AutoEvalManifest.model_validate(decoded)
        except ValueError as error:
            raise SystemImportFetchError(f"GitHub autoeval.json is invalid: {error}") from error
        return manifest, ImportSource(kind="github", display_path=clean_url)

    async def _fetch_json(self, url: str, label: str) -> dict[str, Any]:
        body = await self._fetch_bytes(url, label)
        try:
            value = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise SystemImportFetchError(f"{label} returned invalid JSON") from error
        if not isinstance(value, dict):
            raise SystemImportFetchError(f"{label} returned an unexpected response")
        return value

    async def _fetch_bytes(self, url: str, label: str) -> bytes:
        timeout = httpx.Timeout(GITHUB_TIMEOUT_SECONDS, connect=4.0)
        try:
            async with (
                httpx.AsyncClient(
                    transport=self.transport,
                    follow_redirects=False,
                    timeout=timeout,
                    headers={"Accept": "application/vnd.github+json"},
                    trust_env=False,
                ) as client,
                client.stream("GET", url) as response,
            ):
                if response.is_redirect:
                    raise SystemImportFetchError(f"{label} redirected and was rejected")
                if response.status_code == 404:
                    raise SystemImportFetchError(f"{label} was not found")
                if response.status_code != 200:
                    raise SystemImportFetchError(
                        f"{label} could not be fetched (HTTP {response.status_code})"
                    )
                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > MAX_MANIFEST_BYTES:
                        raise SystemImportFetchError(f"{label} exceeds 512 KiB")
                    chunks.append(chunk)
                return b"".join(chunks)
        except httpx.TimeoutException as error:
            raise SystemImportFetchError(f"{label} timed out") from error
        except httpx.RequestError as error:
            raise SystemImportFetchError(f"{label} could not be fetched") from error

    @staticmethod
    def _source_for_storage(source: ImportSource | None) -> dict[str, Any]:
        if source is None:
            return {"kind": "local"}
        if source.kind == "github" and source.display_path:
            try:
                _owner, _repo, _ref, _path, clean_url = parse_github_url(source.display_path)
            except ValueError:
                return {"kind": "github", "verified": False}
            return {"kind": "github", "display_path": clean_url, "verified": False}
        return {"kind": "local", "display_path": source.display_path}


def primary_prompt_key(system_key: str) -> str:
    return f"{system_key}-system"


def imported_dataset_key(system_key: str) -> str:
    return f"{IMPORTED_DATASET_PREFIX}{system_key}"


def manifest_digest(manifest: AutoEvalManifest) -> str:
    return hash_json(manifest.model_dump(mode="json"))


def parse_github_url(value: str) -> tuple[str, str, str | None, str, str]:
    try:
        parsed = urlsplit(value.strip())
        port = parsed.port
    except ValueError as error:
        raise SystemImportFetchError("GitHub URL has an invalid port") from error
    if (
        parsed.scheme != "https"
        or parsed.hostname != "github.com"
        or parsed.username is not None
        or parsed.password is not None
        or port not in {None, 443}
    ):
        raise SystemImportFetchError("Use an HTTPS github.com repository, tree, or blob URL")
    decoded_path = unquote(parsed.path)
    if "%" in decoded_path or "//" in decoded_path or "\\" in decoded_path:
        raise SystemImportFetchError("GitHub URL path is invalid")
    parts = [part for part in decoded_path.split("/") if part]
    if any(part in {".", ".."} for part in parts):
        raise SystemImportFetchError("GitHub URL path cannot contain dot segments")
    if len(parts) < 2:
        raise SystemImportFetchError("GitHub URL must include an owner and repository")
    owner, repo = parts[0], parts[1].removesuffix(".git")
    if not GITHUB_PART.fullmatch(owner) or not GITHUB_PART.fullmatch(repo):
        raise SystemImportFetchError("GitHub owner or repository name is invalid")

    ref: str | None = None
    manifest_path = "autoeval.json"
    if len(parts) > 2:
        if len(parts) < 4 or parts[2] not in {"tree", "blob"}:
            raise SystemImportFetchError("GitHub URL must point to a repository, tree, or blob")
        ref = parts[3]
        if not GITHUB_PART.fullmatch(ref):
            raise SystemImportFetchError("GitHub branch or tag name is invalid")
        selected = parts[4:]
        if parts[2] == "blob":
            if not selected or selected[-1] != "autoeval.json":
                raise SystemImportFetchError("GitHub blob URL must point to autoeval.json")
            manifest_path = "/".join(selected)
        else:
            manifest_path = "/".join([*selected, "autoeval.json"])

    clean_url = urlunsplit(("https", "github.com", parsed.path.rstrip("/"), "", ""))
    return owner, repo, ref, manifest_path, clean_url
