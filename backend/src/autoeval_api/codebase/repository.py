from __future__ import annotations

import io
import json
import os
import re
import shutil
import subprocess
import tarfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory

from autoeval_api.codebase.schemas import CodebaseSource, CommitSummary, RepositoryInfo

LOGIC_MANIFEST_PATH = ".codemap/logic.json"

SOURCE_SUFFIXES = {
    ".c",
    ".cc",
    ".cpp",
    ".css",
    ".go",
    ".h",
    ".html",
    ".java",
    ".js",
    ".jsx",
    ".kt",
    ".md",
    ".mdx",
    ".mjs",
    ".php",
    ".py",
    ".pyi",
    ".rb",
    ".rs",
    ".scss",
    ".sh",
    ".sql",
    ".swift",
    ".toml",
    ".ts",
    ".tsx",
    ".vue",
    ".yaml",
    ".yml",
}
EXCLUDED_PARTS = {
    ".git",
    ".next",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "vendor",
}
EXCLUDED_NAMES = {
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "poetry.lock",
    "uv.lock",
}
REF_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/@{}~^:+-]{0,159}$")
PR_URL_PATTERN = re.compile(r"^https://github\.com/[^/]+/[^/]+/pull/(\d+)(?:/)?$")


class RepositoryError(RuntimeError):
    """A safe, user-facing repository inspection error."""


@dataclass(frozen=True)
class Snapshot:
    label: str
    files: dict[str, str]


@dataclass(frozen=True)
class ComparisonSnapshots:
    source: CodebaseSource
    label: str
    base_ref: str | None
    target_ref: str
    before: Snapshot
    after: Snapshot


class GitRepository:
    def __init__(self, requested_root: Path, max_files: int, max_file_bytes: int) -> None:
        self.max_files = max_files
        self.max_file_bytes = max_file_bytes
        root = self._discover_root(requested_root)
        self.root = root

    def metadata(self) -> RepositoryInfo:
        head = self.resolve_commit("HEAD")
        branch = self._run_text("symbolic-ref", "--short", "-q", "HEAD", check=False).strip()
        return RepositoryInfo(
            name=self.root.name,
            root=str(self.root),
            branch=branch or "detached",
            head=head,
            short_head=head[:8],
            dirty=bool(self._run_text("status", "--porcelain", "--untracked-files=normal").strip()),
        )

    def recent_commits(self, limit: int = 18) -> list[CommitSummary]:
        output = self._run_text(
            "log",
            f"--max-count={limit}",
            "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1e",
        )
        commits: list[CommitSummary] = []
        for record in output.strip("\n\x1e").split("\x1e"):
            fields = record.strip().split("\x1f")
            if len(fields) != 5:
                continue
            commits.append(
                CommitSummary(
                    oid=fields[0],
                    short_oid=fields[1],
                    subject=fields[2],
                    author=fields[3],
                    authored_at=fields[4],
                )
            )
        return commits

    def comparison(self, source: CodebaseSource, ref: str | None) -> ComparisonSnapshots:
        head = self.resolve_commit("HEAD")
        if source == "current":
            current = Snapshot("working tree", self.worktree_files())
            return ComparisonSnapshots(
                source, "Current structure", None, "working tree", current, current
            )
        if source == "working":
            return ComparisonSnapshots(
                source,
                "Local changes",
                head,
                "working tree",
                Snapshot(head, self.tree_files(head)),
                Snapshot("working tree", self.worktree_files()),
            )
        if source == "staged":
            return ComparisonSnapshots(
                source,
                "Staged changes",
                head,
                "index",
                Snapshot(head, self.tree_files(head)),
                Snapshot("index", self.index_files()),
            )
        if source == "commit":
            target = self.resolve_commit(self._required_ref(ref, "Choose a commit to compare"))
            parent = self.parent_commit(target)
            before_files = self.tree_files(parent) if parent else {}
            return ComparisonSnapshots(
                source,
                f"Commit {target[:8]}",
                parent,
                target,
                Snapshot(parent or "empty tree", before_files),
                Snapshot(target, self.tree_files(target)),
            )
        if source == "pr":
            selector = self._validated_pr_selector(
                self._required_ref(ref, "Enter a PR number or URL")
            )
            pull_request = self._pull_request(selector)
            base = self.merge_base(pull_request["baseRefOid"], pull_request["headRefOid"])
            target = self.resolve_commit(pull_request["headRefOid"])
            number = pull_request["number"]
            title = pull_request["title"]
            return ComparisonSnapshots(
                source,
                f"PR #{number}: {title}",
                base,
                target,
                Snapshot(base, self.tree_files(base)),
                Snapshot(target, self.tree_files(target)),
            )
        raise RepositoryError(f"Unsupported comparison source: {source}")

    def worktree_files(self) -> dict[str, str]:
        output = self._run_bytes("ls-files", "-z", "--cached", "--others", "--exclude-standard")
        paths = self._select_paths(self._decode_paths(output))
        return self._read_paths(self.root, paths)

    def index_files(self) -> dict[str, str]:
        paths = self._select_paths(
            self._decode_paths(self._run_bytes("ls-files", "-z", "--cached"))
        )
        with TemporaryDirectory(prefix="autoeval-codebase-index-") as directory:
            prefix = f"{directory}{os.sep}"
            self._run_bytes("checkout-index", "--all", f"--prefix={prefix}")
            return self._read_paths(Path(directory), paths)

    def tree_files(self, ref: str) -> dict[str, str]:
        resolved = self.resolve_commit(ref)
        entries = self._tree_entries(resolved)
        paths = self._select_paths([path for path, size in entries if size <= self.max_file_bytes])
        if not paths:
            return {}
        archive = self._run_bytes("archive", "--format=tar", resolved, "--", *paths, timeout=45)
        selected = set(paths)
        files: dict[str, str] = {}
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as bundle:
            for member in bundle.getmembers():
                if not member.isfile() or member.name not in selected:
                    continue
                extracted = bundle.extractfile(member)
                if extracted is None:
                    continue
                content = extracted.read(self.max_file_bytes + 1)
                if len(content) <= self.max_file_bytes:
                    files[member.name] = content.decode("utf-8", errors="replace")
        return files

    def resolve_commit(self, ref: str) -> str:
        if not REF_PATTERN.fullmatch(ref) or ref.startswith("-"):
            raise RepositoryError("Commit references contain unsupported characters")
        output = self._run_text(
            "rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}", check=False
        ).strip()
        if not output:
            raise RepositoryError(f"Commit reference was not found: {ref}")
        return output

    def parent_commit(self, commit: str) -> str | None:
        record = self._run_text("rev-list", "--parents", "-n", "1", commit).strip().split()
        return record[1] if len(record) > 1 else None

    def merge_base(self, base: str, head: str) -> str:
        base_commit = self.resolve_commit(base)
        head_commit = self.resolve_commit(head)
        output = self._run_text("merge-base", base_commit, head_commit, check=False).strip()
        if not output:
            raise RepositoryError("The PR base and head do not share a local merge base")
        return output

    def pull_requests_available(self) -> bool:
        return shutil.which("gh") is not None

    def logic_manifest(self) -> str | None:
        path = self.root / LOGIC_MANIFEST_PATH
        try:
            if path.is_symlink() or not path.is_file():
                return None
            content = path.read_bytes()
        except OSError:
            return None
        if len(content) > self.max_file_bytes:
            raise RepositoryError(f"{LOGIC_MANIFEST_PATH} exceeds the configured file-size limit")
        return content.decode("utf-8", errors="replace")

    def _pull_request(self, selector: str) -> dict[str, object]:
        if not self.pull_requests_available():
            raise RepositoryError("GitHub CLI is required for pull request comparisons")
        command = [
            "gh",
            "pr",
            "view",
            selector,
            "--json",
            "number,title,baseRefOid,headRefOid",
        ]
        try:
            result = subprocess.run(
                command,
                cwd=self.root,
                capture_output=True,
                text=True,
                timeout=20,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise RepositoryError("Could not query GitHub for that pull request") from error
        if result.returncode != 0:
            detail = (
                result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "unknown error"
            )
            raise RepositoryError(f"Could not load that pull request: {detail[:220]}")
        try:
            payload = json.loads(result.stdout)
            if not all(payload.get(key) for key in ("number", "title", "baseRefOid", "headRefOid")):
                raise ValueError
            return payload
        except (json.JSONDecodeError, ValueError) as error:
            raise RepositoryError("GitHub returned an incomplete pull request response") from error

    def _tree_entries(self, ref: str) -> list[tuple[str, int]]:
        output = self._run_bytes("ls-tree", "-r", "-l", "-z", ref, "--")
        entries: list[tuple[str, int]] = []
        for raw in output.split(b"\0"):
            if not raw or b"\t" not in raw:
                continue
            metadata, raw_path = raw.split(b"\t", 1)
            fields = metadata.split()
            if len(fields) != 4 or fields[1] != b"blob" or fields[3] == b"-":
                continue
            entries.append((raw_path.decode("utf-8", errors="surrogateescape"), int(fields[3])))
        return entries

    def _select_paths(self, paths: list[str]) -> list[str]:
        candidates = sorted({path for path in paths if self._path_is_supported(path)})
        return candidates[: self.max_files]

    def _path_is_supported(self, raw_path: str) -> bool:
        path = PurePosixPath(raw_path)
        return (
            (raw_path == LOGIC_MANIFEST_PATH or path.suffix.lower() in SOURCE_SUFFIXES)
            and path.name not in EXCLUDED_NAMES
            and not any(part in EXCLUDED_PARTS for part in path.parts)
        )

    def _read_paths(self, base: Path, paths: list[str]) -> dict[str, str]:
        files: dict[str, str] = {}
        resolved_base = base.resolve()
        for relative in paths:
            path = base.joinpath(*PurePosixPath(relative).parts)
            try:
                resolved = path.resolve()
                if (
                    path.is_symlink()
                    or not resolved.is_relative_to(resolved_base)
                    or not path.is_file()
                ):
                    continue
                content = path.read_bytes()
            except OSError:
                continue
            if len(content) <= self.max_file_bytes:
                files[relative] = content.decode("utf-8", errors="replace")
        return files

    @staticmethod
    def _decode_paths(output: bytes) -> list[str]:
        return [
            item.decode("utf-8", errors="surrogateescape") for item in output.split(b"\0") if item
        ]

    @staticmethod
    def _required_ref(ref: str | None, message: str) -> str:
        if not ref or not ref.strip():
            raise RepositoryError(message)
        return ref.strip()

    @staticmethod
    def _validated_pr_selector(selector: str) -> str:
        if selector.startswith("#"):
            selector = selector[1:]
        if selector.isdigit() and int(selector) > 0:
            return selector
        if PR_URL_PATTERN.fullmatch(selector):
            return selector
        raise RepositoryError("Pull requests must use a positive number or a GitHub PR URL")

    @staticmethod
    def _discover_root(requested_root: Path) -> Path:
        try:
            result = subprocess.run(
                [
                    "git",
                    "-C",
                    str(requested_root.expanduser().resolve()),
                    "rev-parse",
                    "--show-toplevel",
                ],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise RepositoryError("Git is required to inspect a codebase") from error
        root = result.stdout.strip()
        if result.returncode != 0 or not root:
            raise RepositoryError("The configured codebase root is not inside a Git repository")
        return Path(root).resolve()

    def _run_text(self, *args: str, check: bool = True, timeout: int = 20) -> str:
        return self._run(*args, check=check, timeout=timeout, text=True)

    def _run_bytes(self, *args: str, timeout: int = 20) -> bytes:
        return self._run(*args, check=True, timeout=timeout, text=False)

    def _run(self, *args: str, check: bool, timeout: int, text: bool) -> str | bytes:
        try:
            result = subprocess.run(
                ["git", *args],
                cwd=self.root,
                capture_output=True,
                text=text,
                timeout=timeout,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise RepositoryError("Git could not inspect the configured repository") from error
        if check and result.returncode != 0:
            stderr = (
                result.stderr
                if isinstance(result.stderr, str)
                else result.stderr.decode(errors="replace")
            )
            detail = stderr.strip().splitlines()[-1] if stderr.strip() else "unknown Git error"
            raise RepositoryError(f"Git could not inspect the repository: {detail[:220]}")
        return result.stdout
