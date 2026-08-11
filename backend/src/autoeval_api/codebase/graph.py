from __future__ import annotations

import difflib
import hashlib
import posixpath
from collections import defaultdict
from dataclasses import dataclass
from pathlib import PurePosixPath

from autoeval_api.codebase.parser import ImportReference, ParsedFile, ParsedSymbol, parse_file
from autoeval_api.codebase.repository import ComparisonSnapshots
from autoeval_api.codebase.schemas import (
    ChangeStatus,
    CodebaseEdge,
    CodebaseGraphResponse,
    CodebaseNode,
    CodebaseSummary,
    ComparisonInfo,
    RepositoryInfo,
)


@dataclass(frozen=True)
class FileDelta:
    path: str
    before_path: str | None
    before: str | None
    after: str | None
    status: ChangeStatus
    additions: int
    deletions: int


class CodebaseGraphBuilder:
    def __init__(self, max_symbols: int) -> None:
        self.max_symbols = max_symbols

    def build(
        self,
        repository: RepositoryInfo,
        comparison: ComparisonSnapshots,
        truncated: bool,
    ) -> CodebaseGraphResponse:
        deltas = file_deltas(comparison.before.files, comparison.after.files)
        parsed_before = {
            delta.before_path or delta.path: parse_file(
                delta.before_path or delta.path, delta.before
            )
            for delta in deltas
            if delta.before is not None
        }
        parsed_after = {
            delta.path: parse_file(delta.path, delta.after)
            for delta in deltas
            if delta.after is not None
        }
        file_nodes, hierarchy_nodes = self._hierarchy_nodes(deltas, parsed_before, parsed_after)
        symbol_nodes = self._symbol_nodes(deltas, parsed_before, parsed_after)
        if len(symbol_nodes) > self.max_symbols:
            symbol_nodes = symbol_nodes[: self.max_symbols]
            truncated = True
        nodes = [*hierarchy_nodes, *file_nodes, *symbol_nodes]
        node_ids = {node.id for node in nodes}
        edges = self._containment_edges(nodes)
        edges.extend(self._import_edges(deltas, parsed_before, parsed_after, node_ids))
        changed = [delta for delta in deltas if delta.status != "unchanged"]
        summary = CodebaseSummary(
            areas=sum(node.kind == "area" for node in nodes),
            modules=sum(node.kind == "module" for node in nodes),
            files=len(file_nodes),
            symbols=len(symbol_nodes),
            changed_files=len(changed),
            additions=sum(delta.additions for delta in changed),
            deletions=sum(delta.deletions for delta in changed),
            truncated=truncated,
        )
        return CodebaseGraphResponse(
            repository=repository,
            comparison=ComparisonInfo(
                source=comparison.source,
                label=comparison.label,
                base_ref=comparison.base_ref,
                target_ref=comparison.target_ref,
            ),
            summary=summary,
            nodes=nodes,
            edges=edges,
        )

    def _hierarchy_nodes(
        self,
        deltas: list[FileDelta],
        parsed_before: dict[str, ParsedFile],
        parsed_after: dict[str, ParsedFile],
    ) -> tuple[list[CodebaseNode], list[CodebaseNode]]:
        all_paths = {delta.path for delta in deltas}
        all_paths.update(delta.before_path for delta in deltas if delta.before_path)
        modules_by_area: dict[str, set[str]] = defaultdict(set)
        deltas_by_area: dict[str, list[FileDelta]] = defaultdict(list)
        deltas_by_module: dict[str, list[FileDelta]] = defaultdict(list)
        file_nodes: list[CodebaseNode] = []
        for delta in deltas:
            area = area_for_path(delta.path)
            module = module_for_path(delta.path, all_paths)
            modules_by_area[area].add(module)
            deltas_by_area[area].append(delta)
            deltas_by_module[module].append(delta)
            parsed = parsed_after.get(delta.path) or parsed_before.get(
                delta.before_path or delta.path
            )
            file_nodes.append(
                CodebaseNode(
                    id=node_id("file", delta.path),
                    kind="file",
                    label=PurePosixPath(delta.path).name,
                    path=delta.path,
                    parent_id=node_id("module", module),
                    detail_level=2,
                    language=parsed.language if parsed else None,
                    lines=parsed.lines if parsed else 0,
                    status=delta.status,
                    additions=delta.additions,
                    deletions=delta.deletions,
                    before_path=delta.before_path if delta.before_path != delta.path else None,
                )
            )
        hierarchy: list[CodebaseNode] = []
        for area in sorted(modules_by_area):
            area_deltas = deltas_by_area[area]
            hierarchy.append(
                CodebaseNode(
                    id=node_id("area", area),
                    kind="area",
                    label=label_for_segment(area),
                    path=area,
                    parent_id=None,
                    detail_level=0,
                    lines=sum(
                        self._delta_lines(delta, parsed_before, parsed_after)
                        for delta in area_deltas
                    ),
                    status=aggregate_status(area_deltas),
                    additions=sum(delta.additions for delta in area_deltas),
                    deletions=sum(delta.deletions for delta in area_deltas),
                )
            )
            for module in sorted(modules_by_area[area]):
                module_deltas = deltas_by_module[module]
                hierarchy.append(
                    CodebaseNode(
                        id=node_id("module", module),
                        kind="module",
                        label=module_label(module),
                        path=module,
                        parent_id=node_id("area", area),
                        detail_level=1,
                        lines=sum(
                            self._delta_lines(delta, parsed_before, parsed_after)
                            for delta in module_deltas
                        ),
                        status=aggregate_status(module_deltas),
                        additions=sum(delta.additions for delta in module_deltas),
                        deletions=sum(delta.deletions for delta in module_deltas),
                    )
                )
        return sorted(file_nodes, key=lambda node: node.path), hierarchy

    def _symbol_nodes(
        self,
        deltas: list[FileDelta],
        parsed_before: dict[str, ParsedFile],
        parsed_after: dict[str, ParsedFile],
    ) -> list[CodebaseNode]:
        nodes: list[CodebaseNode] = []
        for delta in deltas:
            before_file = parsed_before.get(delta.before_path or delta.path)
            after_file = parsed_after.get(delta.path)
            before_symbols = symbol_map(before_file.symbols if before_file else ())
            after_symbols = symbol_map(after_file.symbols if after_file else ())
            for key in sorted(before_symbols.keys() | after_symbols.keys()):
                before_symbol = before_symbols.get(key)
                after_symbol = after_symbols.get(key)
                symbol = after_symbol or before_symbol
                if symbol is None:
                    continue
                if before_symbol is None:
                    status: ChangeStatus = "added"
                elif after_symbol is None:
                    status = "removed"
                elif delta.status in {"modified", "renamed"}:
                    status = "modified"
                else:
                    status = delta.status
                nodes.append(
                    CodebaseNode(
                        id=node_id("symbol", delta.path, f"{symbol.kind}:{symbol.name}"),
                        kind="symbol",
                        label=symbol.name,
                        path=f"{delta.path}:{symbol.line}",
                        parent_id=node_id("file", delta.path),
                        detail_level=3,
                        language=(after_file or before_file).language
                        if after_file or before_file
                        else None,
                        symbol_kind=symbol.kind,
                        line=symbol.line,
                        status=status,
                    )
                )
        return nodes

    def _containment_edges(self, nodes: list[CodebaseNode]) -> list[CodebaseEdge]:
        return [
            CodebaseEdge(
                id=f"contains:{node.parent_id}:{node.id}",
                source=node.parent_id,
                target=node.id,
                kind="contains",
                status=(node.status if node.status in {"added", "removed"} else "unchanged"),
            )
            for node in nodes
            if node.parent_id is not None
        ]

    def _import_edges(
        self,
        deltas: list[FileDelta],
        parsed_before: dict[str, ParsedFile],
        parsed_after: dict[str, ParsedFile],
        node_ids: set[str],
    ) -> list[CodebaseEdge]:
        before_paths = set(parsed_before)
        after_paths = set(parsed_after)
        old_to_new = {
            delta.before_path: delta.path
            for delta in deltas
            if delta.before_path and delta.before_path != delta.path
        }
        before_edges = import_edge_set(parsed_before, before_paths)
        after_edges = import_edge_set(parsed_after, after_paths)
        normalized_before = {
            (old_to_new.get(source, source), old_to_new.get(target, target))
            for source, target in before_edges
        }
        edges: list[CodebaseEdge] = []
        for source, target in sorted(normalized_before | after_edges):
            source_id = node_id("file", source)
            target_id = node_id("file", target)
            if source_id not in node_ids or target_id not in node_ids or source_id == target_id:
                continue
            if (source, target) not in normalized_before:
                status: ChangeStatus = "added"
            elif (source, target) not in after_edges:
                status = "removed"
            else:
                status = "unchanged"
            edges.append(
                CodebaseEdge(
                    id=f"imports:{source_id}:{target_id}",
                    source=source_id,
                    target=target_id,
                    kind="imports",
                    status=status,
                )
            )
        return edges

    @staticmethod
    def _delta_lines(
        delta: FileDelta,
        parsed_before: dict[str, ParsedFile],
        parsed_after: dict[str, ParsedFile],
    ) -> int:
        parsed = parsed_after.get(delta.path) or parsed_before.get(delta.before_path or delta.path)
        return parsed.lines if parsed else 0


def file_deltas(before: dict[str, str], after: dict[str, str]) -> list[FileDelta]:
    removed = set(before) - set(after)
    added = set(after) - set(before)
    renames = detect_renames(before, after, removed, added)
    deltas: list[FileDelta] = []
    consumed_added = set(renames.values())
    consumed_removed = set(renames)
    for old_path, new_path in sorted(renames.items()):
        additions, deletions = line_delta(before[old_path], after[new_path])
        deltas.append(
            FileDelta(
                new_path,
                old_path,
                before[old_path],
                after[new_path],
                "renamed",
                additions,
                deletions,
            )
        )
    for path in sorted(set(before) | set(after)):
        if path in consumed_added or path in consumed_removed:
            continue
        before_content = before.get(path)
        after_content = after.get(path)
        if before_content is None:
            status: ChangeStatus = "added"
        elif after_content is None:
            status = "removed"
        elif before_content != after_content:
            status = "modified"
        else:
            status = "unchanged"
        additions, deletions = line_delta(before_content, after_content)
        deltas.append(
            FileDelta(
                path,
                path if before_content is not None else None,
                before_content,
                after_content,
                status,
                additions,
                deletions,
            )
        )
    return deltas


def line_delta(before: str | None, after: str | None) -> tuple[int, int]:
    before_lines = before.splitlines() if before is not None else []
    after_lines = after.splitlines() if after is not None else []
    additions = 0
    deletions = 0
    for operation, before_start, before_end, after_start, after_end in difflib.SequenceMatcher(
        a=before_lines, b=after_lines, autojunk=False
    ).get_opcodes():
        if operation in {"insert", "replace"}:
            additions += after_end - after_start
        if operation in {"delete", "replace"}:
            deletions += before_end - before_start
    return additions, deletions


def detect_renames(
    before: dict[str, str],
    after: dict[str, str],
    removed: set[str],
    added: set[str],
) -> dict[str, str]:
    added_by_hash: dict[str, list[str]] = defaultdict(list)
    for path in added:
        added_by_hash[content_hash(after[path])].append(path)
    renames: dict[str, str] = {}
    for old_path in sorted(removed):
        matches = added_by_hash.get(content_hash(before[old_path]), [])
        if len(matches) == 1:
            renames[old_path] = matches.pop()
    return renames


def content_hash(content: str) -> str:
    return hashlib.sha1(content.encode("utf-8"), usedforsecurity=False).hexdigest()


def symbol_map(symbols: tuple[ParsedSymbol, ...]) -> dict[tuple[str, str], ParsedSymbol]:
    return {(symbol.kind, symbol.name): symbol for symbol in symbols}


def aggregate_status(deltas: list[FileDelta]) -> ChangeStatus:
    changed = [delta.status for delta in deltas if delta.status != "unchanged"]
    if not changed:
        return "unchanged"
    if all(status == "added" for status in changed) and len(changed) == len(deltas):
        return "added"
    if all(status == "removed" for status in changed) and len(changed) == len(deltas):
        return "removed"
    return "modified"


def import_edge_set(
    parsed_files: dict[str, ParsedFile], available_paths: set[str]
) -> set[tuple[str, str]]:
    edges: set[tuple[str, str]] = set()
    for source, parsed in parsed_files.items():
        for reference in parsed.imports:
            target = resolve_import(source, parsed.language, reference, available_paths)
            if target:
                edges.add((source, target))
    return edges


def resolve_import(
    source: str,
    language: str,
    reference: ImportReference,
    available_paths: set[str],
) -> str | None:
    if language == "Python":
        if reference.level:
            base = PurePosixPath(source).parent
            for _ in range(reference.level - 1):
                base = base.parent
            stem = str(base / reference.module.replace(".", "/"))
        else:
            stem = reference.module.replace(".", "/")
            suffix_matches = _candidate_matches(stem, available_paths)
            return suffix_matches[0] if len(suffix_matches) == 1 else None
    elif reference.module.startswith("@/"):
        area = PurePosixPath(source).parts[0]
        stem = f"{area}/src/{reference.module[2:]}"
    elif reference.module.startswith("."):
        stem = posixpath.normpath(posixpath.join(posixpath.dirname(source), reference.module))
    else:
        return None
    candidates = candidate_paths(stem)
    return next((candidate for candidate in candidates if candidate in available_paths), None)


def _candidate_matches(stem: str, available_paths: set[str]) -> list[str]:
    candidates = candidate_paths(stem)
    return sorted(
        path
        for path in available_paths
        if any(path == candidate or path.endswith(f"/{candidate}") for candidate in candidates)
    )


def candidate_paths(stem: str) -> list[str]:
    suffixes = ["", ".py", ".pyi", ".ts", ".tsx", ".js", ".jsx", ".mjs"]
    candidates = [f"{stem}{suffix}" for suffix in suffixes]
    candidates.extend(f"{stem}/index{suffix}" for suffix in suffixes[1:])
    candidates.extend([f"{stem}/__init__.py", f"{stem}/__init__.pyi"])
    return candidates


def area_for_path(path: str) -> str:
    parts = PurePosixPath(path).parts
    return parts[0] if len(parts) > 1 else "workspace"


def module_for_path(path: str, available_paths: set[str]) -> str:
    parts = list(PurePosixPath(path).parts[:-1])
    if not parts:
        return "workspace/root"
    area = parts.pop(0)
    prefix = area
    if parts and parts[0] in {"src", "lib"}:
        prefix = f"{prefix}/{parts.pop(0)}"
    if len(parts) > 1 and f"{prefix}/{parts[0]}/__init__.py" in available_paths:
        prefix = f"{prefix}/{parts.pop(0)}"
    if not parts:
        return f"{area}/root"
    segment = parts[0]
    if segment in {"agent_systems", "app", "features", "routes"} and len(parts) > 1:
        segment = f"{segment}/{parts[1]}"
    return f"{area}/{segment}"


def module_label(module: str) -> str:
    return module.split("/", 1)[-1]


def label_for_segment(segment: str) -> str:
    return segment.replace("_", " ").replace("-", " ").title()


def node_id(kind: str, path: str, suffix: str | None = None) -> str:
    value = f"{kind}:{path}"
    return f"{value}:{suffix}" if suffix else value
