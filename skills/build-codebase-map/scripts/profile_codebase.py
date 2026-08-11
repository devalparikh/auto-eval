#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
from collections import Counter
from pathlib import Path

EXCLUDED = {
    ".git",
    ".next",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "vendor",
}
LANGUAGES = {
    ".css": "CSS",
    ".go": "Go",
    ".java": "Java",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".kt": "Kotlin",
    ".php": "PHP",
    ".py": "Python",
    ".rb": "Ruby",
    ".rs": "Rust",
    ".swift": "Swift",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".vue": "Vue",
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Profile a repository before adding a code map")
    parser.add_argument("root", nargs="?", default=".")
    parser.add_argument("--max-files", type=int, default=20_000)
    args = parser.parse_args()
    root = Path(args.root).expanduser().resolve()
    if not root.is_dir():
        raise SystemExit(f"Repository root does not exist: {root}")

    files = supported_files(root, args.max_files)
    language_counts = Counter(LANGUAGES[path.suffix.lower()] for path in files)
    markers = detect_markers(root)
    git = git_profile(root)
    print(
        json.dumps(
            {
                "root": str(root),
                "file_count": len(files),
                "languages": dict(language_counts.most_common()),
                "markers": markers,
                "top_level_areas": top_level_counts(root, files),
                "git": git,
                "recommended_levels": ["area", "module", "file", "symbol"],
                "truncated": len(files) >= args.max_files,
            },
            indent=2,
        )
    )


def supported_files(root: Path, limit: int) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if len(files) >= limit:
            break
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(root)
        if any(part in EXCLUDED for part in relative.parts):
            continue
        if path.suffix.lower() in LANGUAGES:
            files.append(path)
    return files


def detect_markers(root: Path) -> list[str]:
    candidates = [
        "AGENTS.md",
        "Cargo.toml",
        "Gemfile",
        "Package.swift",
        "go.mod",
        "package.json",
        "pnpm-workspace.yaml",
        "pyproject.toml",
        "requirements.txt",
    ]
    locations: list[str] = []
    search_roots = [root]
    search_roots.extend(
        path for path in root.iterdir() if path.is_dir() and path.name not in EXCLUDED
    )
    for directory in search_roots:
        for name in candidates:
            marker = directory / name
            if marker.exists():
                locations.append(str(marker.relative_to(root)))
    return sorted(locations)


def top_level_counts(root: Path, files: list[Path]) -> dict[str, int]:
    counts: Counter[str] = Counter()
    for path in files:
        parts = path.relative_to(root).parts
        counts[parts[0] if len(parts) > 1 else "workspace"] += 1
    return dict(counts.most_common())


def git_profile(root: Path) -> dict[str, object]:
    def run(*args: str) -> str:
        result = subprocess.run(
            ["git", "-C", str(root), *args],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        return result.stdout.strip() if result.returncode == 0 else ""

    top_level = run("rev-parse", "--show-toplevel")
    if not top_level:
        return {"repository": False}
    head = run("rev-parse", "HEAD")
    branch = run("symbolic-ref", "--short", "-q", "HEAD") or "detached"
    return {
        "repository": True,
        "top_level": top_level,
        "branch": branch,
        "head": head,
        "dirty": bool(run("status", "--porcelain", "--untracked-files=normal")),
    }


if __name__ == "__main__":
    main()
