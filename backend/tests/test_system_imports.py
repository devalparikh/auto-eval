from copy import deepcopy

import httpx
import pytest
from sqlalchemy import text

from autoeval_api.graph.registry import default_node_handler_registry
from autoeval_api.models import AgentSystemRecord, AgentSystemVersionRecord, PromptRecord
from autoeval_api.services.scoring import ExactJsonMetricSuite, ScoringRegistry
from autoeval_api.services.system_imports import (
    SystemImportService,
    parse_github_url,
)


@pytest.fixture
def manifest():
    return {
        "schema_version": 1,
        "system": {
            "key": "import-test",
            "name": "Import test",
            "description": "Synthetic test agent",
            "input_template": {"text": "Synthetic request"},
        },
        "graph": {
            "entry_point": "read_input",
            "output_node": "write_output",
            "nodes": [
                {
                    "id": "read_input",
                    "label": "Read input",
                    "kind": "deterministic",
                    "handler": "input",
                },
                {
                    "id": "answer",
                    "label": "Answer",
                    "kind": "llm",
                    "handler": "llm_response",
                    "task": "Summarize the request",
                },
                {
                    "id": "write_output",
                    "label": "Write output",
                    "kind": "deterministic",
                    "handler": "output",
                },
            ],
            "edges": [
                {"source": "read_input", "target": "answer"},
                {"source": "answer", "target": "write_output"},
            ],
        },
        "prompt": {"content": "Return a JSON object."},
    }


def inspect(client, manifest):
    response = client.post("/api/system-imports/inspect", json={"manifest": manifest})
    assert response.status_code == 200, response.text
    return response.json()


def commit_payload(preview):
    return {
        "manifest": preview["manifest"],
        "expected_digest": preview["digest"],
        "expected_system_key": preview["manifest"]["system"]["key"],
        "expected_system_id": preview["existing_system_id"],
        "expected_graph_version": preview["next_graph_version"],
        "expected_prompt_version": preview["next_prompt_version"],
        "source": preview["source"],
    }


def import_manifest(client, manifest):
    response = client.post(
        "/api/system-imports/commit", json=commit_payload(inspect(client, manifest))
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_import_is_reviewed_atomic_and_runnable_through_evaluation(
    client, session_factory, manifest
):
    preview = inspect(client, manifest)
    assert preview["creates_system"]
    assert preview["counts"]["llm_nodes"] == 1
    with session_factory() as session:
        assert session.query(AgentSystemRecord).filter_by(key="import-test").first() is None
    response = client.post("/api/system-imports/commit", json=commit_payload(preview))
    assert response.status_code == 201, response.text
    imported = response.json()
    catalog = client.get("/api/catalog").json()
    system = next(row for row in catalog["agent_systems"] if row["key"] == "import-test")
    assert system["input_template"] == manifest["system"]["input_template"]
    assert system["input_editor"] == "json"
    dataset = next(row for row in catalog["datasets"] if row["id"] == imported["dataset_id"])
    assert dataset["versions"][0]["item_count"] == 0
    assert dataset["versions"][0]["status"] == "draft"

    response = client.post(
        "/api/traces/run",
        json={
            "agent_system_id": imported["agent_system_id"],
            "model_id": "mock/incident-fast",
            "input": {"text": "Synthetic request"},
        },
    )
    assert response.status_code == 201, response.text
    trace = response.json()
    assert trace["status"] == "complete", trace
    assert trace["output"] == {"result": "Mock provider completed the requested task."}
    assert len(trace["spans"]) == 3
    assert trace["agent_system_version_id"] == imported["graph_version_id"]

    dataset_version = imported["dataset_version_id"]
    response = client.put(
        f"/api/dataset-versions/{dataset_version}/trace-items/{trace['id']}",
        json={"expected": trace["output"]},
    )
    assert response.status_code in {200, 201}, response.text
    response = client.post(f"/api/dataset-versions/{dataset_version}/finalize")
    assert response.status_code == 200, response.text
    response = client.post(
        "/api/eval-runs",
        json={
            "dataset_version_id": dataset_version,
            "model_ids": ["mock/incident-fast"],
            "run_in_background": False,
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "complete", response.text
    assert response.json()["results"][0]["metrics"]["exact_match"] == 1


def test_import_reuses_unchanged_versions_and_preserves_history(client, manifest):
    first = import_manifest(client, manifest)
    original = client.get(f"/api/agent-system-versions/{first['graph_version_id']}").json()
    manifest["graph"]["nodes"][1]["label"] = "Answer carefully"
    preview = inspect(client, manifest)
    assert preview["target_graph_version"] == 2
    assert preview["target_prompt_version"] == 1
    second = import_manifest(client, manifest)
    assert second["graph_version_created"] and not second["prompt_version_created"]
    assert second["prompt_version_id"] == first["prompt_version_id"]
    manifest["prompt"]["content"] = "Return a concise JSON object."
    third = import_manifest(client, manifest)
    assert not third["graph_version_created"] and third["prompt_version_created"]
    assert third["graph_version_id"] == second["graph_version_id"]
    assert client.get(f"/api/agent-system-versions/{first['graph_version_id']}").json() == original
    response = client.post(
        "/api/system-imports/commit", json=commit_payload(inspect(client, manifest))
    )
    assert response.status_code == 409
    assert "Nothing to import" in response.text


@pytest.mark.parametrize(
    "field,value",
    [
        ("expected_digest", "a" * 64),
        ("expected_system_key", "wrong-key"),
        ("expected_system_id", "wrong-id"),
        ("expected_graph_version", 12),
        ("expected_prompt_version", 12),
    ],
)
def test_changed_preview_cannot_commit(client, session_factory, manifest, field, value):
    payload = commit_payload(inspect(client, manifest))
    payload[field] = value
    response = client.post("/api/system-imports/commit", json=payload)
    assert response.status_code == 409
    with session_factory() as session:
        assert session.query(AgentSystemRecord).filter_by(key="import-test").count() == 0


def test_stale_preview_conflicts_after_another_import(client, manifest):
    payload = commit_payload(inspect(client, manifest))
    import_manifest(client, manifest)
    assert client.post("/api/system-imports/commit", json=payload).status_code == 409


def test_local_manifest_size_is_bounded(client, session_factory, manifest):
    manifest["system"]["input_template"] = {"text": "x" * (512 * 1024)}
    response = client.post("/api/system-imports/inspect", json={"manifest": manifest})
    assert response.status_code == 422
    assert "512 KiB" in response.text
    with session_factory() as session:
        assert session.query(AgentSystemRecord).filter_by(key="import-test").count() == 0


@pytest.mark.parametrize(
    "problem",
    ["handler", "cycle", "unreachable", "prompt", "policy", "duplicate_edge", "missing_output"],
)
def test_invalid_graph_cannot_import(client, manifest, problem):
    graph = manifest["graph"]
    if problem == "handler":
        graph["nodes"][0]["handler"] = "arbitrary_python"
    elif problem == "cycle":
        graph["edges"].append({"source": "write_output", "target": "read_input"})
    elif problem == "unreachable":
        graph["edges"] = graph["edges"][1:]
    elif problem == "prompt":
        graph["nodes"][1]["prompt_key"] = "incident-triage-classification"
    elif problem == "policy":
        graph["nodes"][0]["runtime_input_policy"] = {"source": "unknown_provider"}
    elif problem == "duplicate_edge":
        graph["edges"].append(deepcopy(graph["edges"][0]))
    else:
        graph["nodes"][2]["handler"] = "input"
    response = client.post("/api/system-imports/inspect", json={"manifest": manifest})
    assert response.status_code == 422, response.text


def test_version_editor_rejects_unregistered_handlers(client, manifest):
    imported = import_manifest(client, manifest)
    graph = deepcopy(manifest["graph"])
    graph["nodes"][0]["handler"] = "arbitrary_python"
    response = client.post(
        f"/api/agent-systems/{imported['agent_system_id']}/versions", json={"definition": graph}
    )
    assert response.status_code == 409
    assert "Unknown deterministic" in response.text


def test_failed_insert_rolls_back_every_import_record(client, session_factory, manifest):
    with session_factory() as session:
        session.execute(
            text(
                "CREATE TRIGGER reject_imported_dataset BEFORE INSERT ON datasets "
                "WHEN NEW.key LIKE 'imported--%' "
                "BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END"
            )
        )
        session.commit()
    response = client.post(
        "/api/system-imports/commit", json=commit_payload(inspect(client, manifest))
    )
    assert response.status_code == 409, response.text
    with session_factory() as session:
        assert session.query(AgentSystemRecord).filter_by(key="import-test").count() == 0
        assert session.query(PromptRecord).filter_by(key="import-test-system").count() == 0
        assert (
            session.query(AgentSystemVersionRecord)
            .join(AgentSystemRecord)
            .filter(AgentSystemRecord.key == "import-test")
            .count()
            == 0
        )


@pytest.mark.asyncio
async def test_github_fetches_manifest_with_bounded_fixed_hosts(session_factory, manifest):
    requests = []

    def handler(request):
        requests.append(str(request.url))
        if request.url.host == "api.github.com":
            return httpx.Response(200, json={"default_branch": "main"})
        return httpx.Response(200, json=manifest)

    service = SystemImportService(
        default_node_handler_registry(), transport=httpx.MockTransport(handler)
    )
    with session_factory() as session:
        preview = await service.inspect_github(
            session, "https://github.com/example/agent?secret=removed"
        )
    assert requests == [
        "https://api.github.com/repos/example/agent",
        "https://raw.githubusercontent.com/example/agent/main/autoeval.json",
    ]
    assert preview.manifest.system.key == "import-test"
    assert preview.source.display_path == "https://github.com/example/agent"


@pytest.mark.parametrize(
    "url",
    [
        "http://github.com/a/b",
        "https://github.com.evil.test/a/b",
        "https://user:secret@github.com/a/b",
        "https://127.0.0.1/a/b",
        "https://github.com/a/b/tree/main/../private",
        "https://github.com/a/b/blob/main/file.py",
        "https://[invalid",
        "https://github.com/a/b/tree/main/%2e%2e/private",
    ],
)
def test_github_rejects_unsafe_or_nonmanifest_urls(url):
    with pytest.raises(ValueError):
        parse_github_url(url)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status,content",
    [(307, b""), (404, b""), (200, b"x" * (512 * 1024 + 1)), (200, b"not json")],
    ids=["redirect", "missing", "oversized", "invalid-json"],
)
async def test_github_fetch_failures_are_actionable(session_factory, status, content):
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            status, content=content, headers={"Location": "http://127.0.0.1/secret"}
        )
    )
    service = SystemImportService(default_node_handler_registry(), transport=transport)
    with session_factory() as session, pytest.raises(ValueError):
        await service.inspect_github(
            session, "https://github.com/example/agent/blob/main/autoeval.json"
        )


def test_exact_json_scoring_is_type_sensitive_and_can_be_overridden():
    registry = ScoringRegistry()
    suite = registry.for_dataset("imported--test")
    assert suite.score_item({"ok": True}, {"ok": 1})["exact_match"] == 0
    assert suite.score_item({"a": 1, "b": 2}, {"b": 2, "a": 1})["exact_match"] == 1
    custom = ExactJsonMetricSuite()
    registry.register("imported--test", custom)
    assert registry.for_dataset("imported--test") is custom
    with pytest.raises(ValueError, match="No scoring suite"):
        registry.for_dataset("unregistered-custom-dataset")
