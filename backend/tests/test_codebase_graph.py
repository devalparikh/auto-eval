import json
import subprocess
from pathlib import Path

import pytest

from autoeval_api.codebase.service import CodebaseGraphService


@pytest.fixture
def codebase_repo(tmp_path: Path) -> Path:
    run_git(tmp_path, "init", "-q")
    run_git(tmp_path, "config", "user.email", "autoeval@example.test")
    run_git(tmp_path, "config", "user.name", "AutoEval Test")
    write_file(
        tmp_path,
        "src/app/main.py",
        "from .helper import greet\n\n\ndef run(name: str) -> str:\n    return greet(name)\n",
    )
    write_file(
        tmp_path,
        "src/app/helper.py",
        "def greet(name: str) -> str:\n    return f'Hello {name}'\n",
    )
    write_file(
        tmp_path,
        "web/view.tsx",
        'import { Button } from "./button";\nexport function View() { return <Button />; }\n',
    )
    write_file(
        tmp_path,
        "web/button.tsx",
        "export function Button() { return <button>Run</button>; }\n",
    )
    run_git(tmp_path, "add", ".")
    run_git(tmp_path, "commit", "-qm", "initial structure")
    return tmp_path


def test_working_graph_marks_files_symbols_and_imports(codebase_repo: Path) -> None:
    write_file(
        codebase_repo,
        "src/app/main.py",
        "from .helper import greet\n\n\nclass Runner:\n"
        "    def run(self, name: str) -> str:\n        return greet(name)\n",
    )
    write_file(codebase_repo, "src/app/policy.py", "class Policy:\n    enabled = True\n")
    (codebase_repo / "web/button.tsx").unlink()

    graph = CodebaseGraphService(codebase_repo).graph("working")
    files = {node.path: node for node in graph.nodes if node.kind == "file"}

    assert files["src/app/main.py"].status == "modified"
    assert files["src/app/policy.py"].status == "added"
    assert files["web/button.tsx"].status == "removed"
    assert graph.summary.changed_files == 3
    assert any(
        node.kind == "symbol" and node.label == "Runner" and node.status == "added"
        for node in graph.nodes
    )
    assert any(
        edge.kind == "imports"
        and edge.source == "file:src/app/main.py"
        and edge.target == "file:src/app/helper.py"
        for edge in graph.edges
    )


def test_staged_and_commit_graphs_use_exact_git_snapshots(codebase_repo: Path) -> None:
    write_file(codebase_repo, "src/app/new_rule.py", "def allow() -> bool:\n    return True\n")
    run_git(codebase_repo, "add", "src/app/new_rule.py")
    service = CodebaseGraphService(codebase_repo)

    staged = service.graph("staged")
    staged_file = next(node for node in staged.nodes if node.path == "src/app/new_rule.py")
    assert staged_file.status == "added"
    assert staged.comparison.target_ref == "index"

    run_git(codebase_repo, "commit", "-qm", "add policy rule")
    commit = run_git(codebase_repo, "rev-parse", "HEAD").strip()
    committed = service.graph("commit", commit)
    committed_file = next(node for node in committed.nodes if node.path == "src/app/new_rule.py")
    assert committed_file.status == "added"
    assert committed.comparison.target_ref == commit


def test_codebase_api_uses_configured_service(client, codebase_repo: Path) -> None:
    client.app.state.codebase_service = CodebaseGraphService(codebase_repo)

    revisions = client.get("/api/codebase/revisions")
    graph = client.get("/api/codebase/graph", params={"source": "current"})
    invalid_pr = client.get("/api/codebase/graph", params={"source": "pr", "ref": "oops"})

    assert revisions.status_code == 200
    assert revisions.json()["repository"]["name"] == codebase_repo.name
    assert graph.status_code == 200
    assert graph.json()["summary"]["files"] == 4
    assert invalid_pr.status_code == 422
    assert "positive number" in invalid_pr.json()["detail"]


def test_logic_graph_projects_file_changes_onto_maintained_components(
    codebase_repo: Path,
) -> None:
    write_file(codebase_repo, ".codemap/logic.json", json.dumps(logic_manifest()))
    write_file(
        codebase_repo,
        "src/app/main.py",
        "from .helper import greet\n\n\n"
        "def run(name: str) -> str:\n"
        "    return greet(name).upper()\n",
    )

    graph = CodebaseGraphService(codebase_repo).graph("working", mode="logic")
    nodes = {node.path: node for node in graph.nodes}

    assert graph.mode == "logic"
    assert graph.model_path == ".codemap/logic.json"
    assert nodes["backend.runtime.execute"].status == "modified"
    assert nodes["backend.runtime.execute.runner"].additions == 1
    assert graph.summary.areas == 1
    assert graph.summary.symbols == 1


def test_logic_api_uses_mode_query(client, codebase_repo: Path) -> None:
    write_file(codebase_repo, ".codemap/logic.json", json.dumps(logic_manifest()))
    client.app.state.codebase_service = CodebaseGraphService(codebase_repo)

    response = client.get(
        "/api/codebase/graph",
        params={"source": "current", "mode": "logic"},
    )

    assert response.status_code == 200
    assert response.json()["mode"] == "logic"
    assert response.json()["nodes"][0]["kind"] == "system"


def test_logic_commit_comparison_uses_versioned_manifest(codebase_repo: Path) -> None:
    write_file(codebase_repo, ".codemap/logic.json", json.dumps(logic_manifest()))
    run_git(codebase_repo, "add", ".codemap/logic.json")
    run_git(codebase_repo, "commit", "-qm", "add logic model")
    write_file(
        codebase_repo,
        "src/app/main.py",
        "from .helper import greet\n\n\n"
        "def run(name: str) -> str:\n"
        "    return greet(name).upper()\n",
    )
    run_git(codebase_repo, "add", "src/app/main.py")
    run_git(codebase_repo, "commit", "-qm", "change runtime behavior")
    target = run_git(codebase_repo, "rev-parse", "HEAD").strip()

    graph = CodebaseGraphService(codebase_repo).graph("commit", target, mode="logic")
    nodes = {node.path: node for node in graph.nodes}

    assert graph.comparison.target_ref == target
    assert nodes["backend.runtime.execute.runner"].status == "modified"


def logic_manifest() -> dict:
    return {
        "schema_version": 1,
        "title": "Example logic",
        "components": [
            {
                "id": "backend",
                "kind": "system",
                "label": "Backend",
                "description": "Example backend.",
                "paths": ["src/**"],
                "responsibilities": ["Serve the example"],
            },
            {
                "id": "backend.runtime",
                "kind": "domain",
                "label": "Runtime",
                "description": "Executes application behavior.",
                "parent_id": "backend",
                "paths": ["src/app/**"],
            },
            {
                "id": "backend.runtime.execute",
                "kind": "capability",
                "label": "Execution",
                "description": "Runs the application flow.",
                "parent_id": "backend.runtime",
                "paths": ["src/app/*.py"],
            },
            {
                "id": "backend.runtime.execute.runner",
                "kind": "component",
                "label": "Runner",
                "description": "Entrypoint orchestration.",
                "parent_id": "backend.runtime.execute",
                "paths": ["src/app/main.py"],
            },
        ],
        "relations": [],
    }


def run_git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def write_file(root: Path, relative: str, content: str) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
