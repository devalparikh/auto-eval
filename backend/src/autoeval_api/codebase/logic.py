from __future__ import annotations

import fnmatch
import json
from typing import Literal

from pydantic import Field, ValidationError, model_validator

from autoeval_api.codebase.graph import FileDelta, file_deltas
from autoeval_api.codebase.repository import (
    LOGIC_MANIFEST_PATH,
    ComparisonSnapshots,
    RepositoryError,
)
from autoeval_api.codebase.schemas import (
    ChangeStatus,
    CodebaseEdge,
    CodebaseGraphResponse,
    CodebaseModel,
    CodebaseNode,
    CodebaseSummary,
    ComparisonInfo,
    RepositoryInfo,
)

LogicNodeKind = Literal["system", "domain", "capability", "component"]
LogicRelationKind = Literal["depends_on", "calls", "produces", "consumes"]
KIND_LEVEL: dict[LogicNodeKind, int] = {
    "system": 0,
    "domain": 1,
    "capability": 2,
    "component": 3,
}


class LogicComponent(CodebaseModel):
    id: str = Field(min_length=1, max_length=120, pattern=r"^[a-z0-9][a-z0-9._-]*$")
    kind: LogicNodeKind
    label: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=360)
    parent_id: str | None = None
    paths: list[str] = Field(default_factory=list, max_length=40)
    responsibilities: list[str] = Field(default_factory=list, max_length=12)


class LogicRelation(CodebaseModel):
    source: str
    target: str
    kind: LogicRelationKind
    label: str | None = Field(default=None, max_length=120)


class LogicManifest(CodebaseModel):
    schema_version: Literal[1]
    title: str = Field(min_length=1, max_length=120)
    components: list[LogicComponent] = Field(min_length=1, max_length=500)
    relations: list[LogicRelation] = Field(default_factory=list, max_length=1_000)

    @model_validator(mode="after")
    def validate_graph(self) -> LogicManifest:
        components = {component.id: component for component in self.components}
        if len(components) != len(self.components):
            raise ValueError("component IDs must be unique")
        for component in self.components:
            self._validate_component(component, components)
        for relation in self.relations:
            if relation.source not in components or relation.target not in components:
                raise ValueError("relation endpoints must reference component IDs")
            if relation.source == relation.target:
                raise ValueError("logic relations cannot point to the same component")
        return self

    @staticmethod
    def _validate_component(
        component: LogicComponent,
        components: dict[str, LogicComponent],
    ) -> None:
        level = KIND_LEVEL[component.kind]
        if level == 0 and component.parent_id is not None:
            raise ValueError(f"system {component.id} cannot have a parent")
        if level > 0:
            parent = components.get(component.parent_id or "")
            if parent is None or KIND_LEVEL[parent.kind] != level - 1:
                raise ValueError(
                    f"{component.kind} {component.id} must have a level-{level - 1} parent"
                )
        for pattern in component.paths:
            if not pattern or pattern.startswith("/") or ".." in pattern.split("/"):
                raise ValueError(f"component {component.id} contains an unsafe path pattern")


class LogicGraphBuilder:
    def build(
        self,
        repository: RepositoryInfo,
        comparison: ComparisonSnapshots,
        truncated: bool,
        fallback_manifest: str | None,
    ) -> CodebaseGraphResponse:
        fallback = parse_logic_manifest(fallback_manifest, "working tree", required=False)
        before = self._manifest_for_snapshot(comparison.before.files, fallback, "base")
        after = self._manifest_for_snapshot(comparison.after.files, fallback, "target")
        if before is None and after is None:
            raise RepositoryError(
                f"Logic mode needs {LOGIC_MANIFEST_PATH}. "
                "Ask your coding agent to run $maintain-codebase-logic."
            )
        before = before or after
        after = after or before
        assert before is not None and after is not None

        deltas = [
            delta
            for delta in file_deltas(comparison.before.files, comparison.after.files)
            if delta.path != LOGIC_MANIFEST_PATH
        ]
        nodes = self._nodes(before, after, deltas)
        edges = [*self._containment_edges(nodes), *self._relation_edges(before, after)]
        changed = [delta for delta in deltas if delta.status != "unchanged"]
        return CodebaseGraphResponse(
            mode="logic",
            model_path=LOGIC_MANIFEST_PATH,
            repository=repository,
            comparison=ComparisonInfo(
                source=comparison.source,
                label=comparison.label,
                base_ref=comparison.base_ref,
                target_ref=comparison.target_ref,
            ),
            summary=CodebaseSummary(
                areas=sum(node.detail_level == 0 for node in nodes),
                modules=sum(node.detail_level == 1 for node in nodes),
                files=sum(node.detail_level == 2 for node in nodes),
                symbols=sum(node.detail_level == 3 for node in nodes),
                changed_files=len(changed),
                additions=sum(delta.additions for delta in changed),
                deletions=sum(delta.deletions for delta in changed),
                truncated=truncated,
            ),
            nodes=nodes,
            edges=edges,
        )

    @staticmethod
    def _manifest_for_snapshot(
        files: dict[str, str],
        fallback: LogicManifest | None,
        label: str,
    ) -> LogicManifest | None:
        content = files.get(LOGIC_MANIFEST_PATH)
        if content is None:
            return fallback
        return parse_logic_manifest(content, label)

    def _nodes(
        self,
        before: LogicManifest,
        after: LogicManifest,
        deltas: list[FileDelta],
    ) -> list[CodebaseNode]:
        before_by_id = {component.id: component for component in before.components}
        after_by_id = {component.id: component for component in after.components}
        nodes: list[CodebaseNode] = []
        for component_id in sorted(before_by_id.keys() | after_by_id.keys()):
            previous = before_by_id.get(component_id)
            current = after_by_id.get(component_id)
            component = current or previous
            assert component is not None
            owned_deltas = matching_deltas(component.paths, deltas)
            status = component_status(previous, current, owned_deltas)
            nodes.append(
                CodebaseNode(
                    id=logic_node_id(component.id),
                    kind=component.kind,
                    label=component.label,
                    path=component.id,
                    parent_id=(logic_node_id(component.parent_id) if component.parent_id else None),
                    detail_level=KIND_LEVEL[component.kind],
                    lines=sum(delta_line_count(delta) for delta in owned_deltas),
                    status=status,
                    additions=sum(delta.additions for delta in owned_deltas),
                    deletions=sum(delta.deletions for delta in owned_deltas),
                    description=component.description,
                    source_paths=component.paths,
                    responsibilities=component.responsibilities,
                )
            )
        return nodes

    @staticmethod
    def _containment_edges(nodes: list[CodebaseNode]) -> list[CodebaseEdge]:
        return [
            CodebaseEdge(
                id=f"contains:{node.parent_id}:{node.id}",
                source=node.parent_id,
                target=node.id,
                kind="contains",
                status=(node.status if node.status in {"added", "removed"} else "unchanged"),
            )
            for node in nodes
            if node.parent_id
        ]

    @staticmethod
    def _relation_edges(
        before: LogicManifest,
        after: LogicManifest,
    ) -> list[CodebaseEdge]:
        previous = {relation_key(relation): relation for relation in before.relations}
        current = {relation_key(relation): relation for relation in after.relations}
        edges: list[CodebaseEdge] = []
        for key in sorted(previous.keys() | current.keys()):
            old = previous.get(key)
            new = current.get(key)
            relation = new or old
            assert relation is not None
            if old is None:
                status: ChangeStatus = "added"
            elif new is None:
                status = "removed"
            elif old != new:
                status = "modified"
            else:
                status = "unchanged"
            edges.append(
                CodebaseEdge(
                    id=f"logic-relation:{key}",
                    source=logic_node_id(relation.source),
                    target=logic_node_id(relation.target),
                    kind=relation.kind,
                    status=status,
                    label=relation.label,
                )
            )
        return edges


def parse_logic_manifest(
    content: str | None,
    label: str,
    required: bool = True,
) -> LogicManifest | None:
    if content is None:
        if required:
            raise RepositoryError(f"{LOGIC_MANIFEST_PATH} is missing from the {label} snapshot")
        return None
    try:
        payload = json.loads(content)
        return LogicManifest.model_validate(payload)
    except (json.JSONDecodeError, ValidationError) as error:
        raise RepositoryError(
            f"{LOGIC_MANIFEST_PATH} is invalid in the {label} snapshot"
        ) from error


def matching_deltas(patterns: list[str], deltas: list[FileDelta]) -> list[FileDelta]:
    if not patterns:
        return []
    return [
        delta
        for delta in deltas
        if any(
            fnmatch.fnmatchcase(delta.path, pattern)
            or (delta.before_path is not None and fnmatch.fnmatchcase(delta.before_path, pattern))
            for pattern in patterns
        )
    ]


def component_status(
    previous: LogicComponent | None,
    current: LogicComponent | None,
    deltas: list[FileDelta],
) -> ChangeStatus:
    if previous is None:
        return "added"
    if current is None:
        return "removed"
    if previous != current or any(delta.status != "unchanged" for delta in deltas):
        return "modified"
    return "unchanged"


def delta_line_count(delta: FileDelta) -> int:
    content = delta.after if delta.after is not None else delta.before
    return content.count("\n") + (1 if content else 0) if content is not None else 0


def logic_node_id(component_id: str) -> str:
    return f"logic:{component_id}"


def relation_key(relation: LogicRelation) -> str:
    return f"{relation.source}:{relation.target}:{relation.kind}"
