from pathlib import Path

from autoeval_api.codebase.graph import CodebaseGraphBuilder
from autoeval_api.codebase.logic import LogicGraphBuilder
from autoeval_api.codebase.repository import GitRepository
from autoeval_api.codebase.schemas import (
    CodebaseGraphResponse,
    CodebaseMode,
    CodebaseRevisionsResponse,
    CodebaseSource,
)


class CodebaseGraphService:
    def __init__(
        self,
        root: Path,
        max_files: int = 600,
        max_file_bytes: int = 256_000,
        max_symbols: int = 1_600,
    ) -> None:
        self.repository = GitRepository(root, max_files, max_file_bytes)
        self.builder = CodebaseGraphBuilder(max_symbols)
        self.logic_builder = LogicGraphBuilder()
        self.max_files = max_files

    def revisions(self) -> CodebaseRevisionsResponse:
        return CodebaseRevisionsResponse(
            repository=self.repository.metadata(),
            commits=self.repository.recent_commits(),
            pull_requests_available=self.repository.pull_requests_available(),
        )

    def graph(
        self,
        source: CodebaseSource,
        ref: str | None = None,
        mode: CodebaseMode = "files",
    ) -> CodebaseGraphResponse:
        comparison = self.repository.comparison(source, ref)
        discovered_count = len(set(comparison.before.files) | set(comparison.after.files))
        if mode == "logic":
            return self.logic_builder.build(
                self.repository.metadata(),
                comparison,
                truncated=discovered_count >= self.max_files,
                fallback_manifest=self.repository.logic_manifest(),
            )
        return self.builder.build(
            self.repository.metadata(),
            comparison,
            truncated=discovered_count >= self.max_files,
        )
