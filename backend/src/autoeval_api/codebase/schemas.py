from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CodebaseSource = Literal["current", "working", "staged", "commit", "pr"]
CodebaseMode = Literal["files", "logic"]
NodeKind = Literal[
    "area",
    "module",
    "file",
    "symbol",
    "system",
    "domain",
    "capability",
    "component",
]
EdgeKind = Literal[
    "contains",
    "imports",
    "depends_on",
    "calls",
    "produces",
    "consumes",
]
ChangeStatus = Literal["unchanged", "added", "modified", "removed", "renamed"]


class CodebaseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RepositoryInfo(CodebaseModel):
    name: str
    root: str
    branch: str
    head: str
    short_head: str
    dirty: bool


class ComparisonInfo(CodebaseModel):
    source: CodebaseSource
    label: str
    base_ref: str | None
    target_ref: str


class CodebaseNode(CodebaseModel):
    id: str
    kind: NodeKind
    label: str
    path: str
    parent_id: str | None
    detail_level: int
    language: str | None = None
    symbol_kind: str | None = None
    line: int | None = None
    lines: int = 0
    status: ChangeStatus = "unchanged"
    additions: int = 0
    deletions: int = 0
    before_path: str | None = None
    description: str | None = None
    source_paths: list[str] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)


class CodebaseEdge(CodebaseModel):
    id: str
    source: str
    target: str
    kind: EdgeKind
    status: ChangeStatus = "unchanged"
    label: str | None = None


class CodebaseSummary(CodebaseModel):
    areas: int
    modules: int
    files: int
    symbols: int
    changed_files: int
    additions: int
    deletions: int
    truncated: bool


class CodebaseGraphResponse(CodebaseModel):
    mode: CodebaseMode = "files"
    model_path: str | None = None
    repository: RepositoryInfo
    comparison: ComparisonInfo
    summary: CodebaseSummary
    nodes: list[CodebaseNode]
    edges: list[CodebaseEdge]


class CommitSummary(CodebaseModel):
    oid: str
    short_oid: str
    subject: str
    author: str
    authored_at: str


class CodebaseRevisionsResponse(CodebaseModel):
    repository: RepositoryInfo
    commits: list[CommitSummary]
    pull_requests_available: bool
