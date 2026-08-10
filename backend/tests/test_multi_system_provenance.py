import json
from copy import deepcopy

import pytest
from sqlalchemy.exc import IntegrityError

from autoeval_api.agent_systems.portfolio_analyst.definition import (
    PORTFOLIO_INPUT_TEMPLATE,
)
from autoeval_api.agent_systems.portfolio_analyst.seed import ensure_seed_data
from autoeval_api.agent_systems.portfolio_query.definition import (
    PORTFOLIO_QUERY_INPUT_TEMPLATE,
)
from autoeval_api.agent_systems.portfolio_query.seed import (
    ensure_seed_data as ensure_portfolio_query_seed_data,
)
from autoeval_api.models import (
    AgentSystemRecord,
    DatasetItemRecord,
    DatasetRecord,
    DatasetStatus,
    DatasetVersionRecord,
)


def test_portfolio_system_runs_with_sanitized_trace(client, session_factory) -> None:
    session = session_factory()
    graph, prompt, _ = ensure_seed_data(session)
    system = session.get(AgentSystemRecord, graph.agent_system_id)
    request_input = deepcopy(PORTFOLIO_INPUT_TEMPLATE)
    request_input["profile"]["name"] = "Synthetic owner"
    request_input["holdings"][0]["value"] = 125_000

    response = client.post(
        "/api/traces/run",
        json={
            "agent_system_id": system.id,
            "agent_system_version_id": graph.id,
            "prompt_version_id": prompt.id,
            "model_id": "mock/portfolio-analyst",
            "input": request_input,
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["agent_system_key"] == "portfolio-analyst"
    assert payload["output"]["analysis_ready"] is True
    assert payload["output"]["metrics"]["top_holding_symbol"] == "BROAD_MARKET"
    assert "name" not in payload["request_input"]["profile"]
    assert "value" not in payload["request_input"]["holdings"][0]
    assert all("Synthetic owner" not in str(span["input"]) for span in payload["spans"])


def test_portfolio_query_uses_only_safe_supplied_candidates(client, session_factory) -> None:
    session = session_factory()
    graph, prompt, _ = ensure_portfolio_query_seed_data(session)
    system = session.get(AgentSystemRecord, graph.agent_system_id)

    response = client.post(
        "/api/traces/run",
        json={
            "agent_system_id": system.id,
            "agent_system_version_id": graph.id,
            "prompt_version_id": prompt.id,
            "model_id": "mock/portfolio-analyst",
            "input": deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE),
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "complete"
    assert payload["agent_system_key"] == "portfolio-query"
    assert payload["output"]["covered_call"]["status"] == "candidates"
    candidates = payload["output"]["covered_call"]["candidates"]
    assert [item["candidate_id"] for item in candidates] == ["candidate-001"]
    assert candidates[0]["rank"] == 1
    persisted = json.dumps(payload, sort_keys=True)
    assert payload["request_input"]["snapshot_id"] == "synthetic-indexed-portfolio-v2"
    assert "snapshot" not in payload["request_input"]
    assert '"account_id"' not in persisted
    assert '"cost_basis"' not in persisted
    assert '"market_value"' not in persisted


def test_trace_membership_is_scoped_idempotent_and_conflict_safe(client, session_factory) -> None:
    session = session_factory()
    system = session.query(AgentSystemRecord).filter_by(key="incident-triage").one()
    dataset = session.query(DatasetRecord).filter_by(agent_system_id=system.id).one()
    catalog = client.get("/api/catalog").json()
    dataset_summary = next(item for item in catalog["datasets"] if item["id"] == dataset.id)
    draft = next(item for item in dataset_summary["versions"] if item["status"] == "draft")
    trace = client.post(
        "/api/traces/run",
        json={
            "agent_system_id": system.id,
            "model_id": "mock/incident-specialist",
            "input": {"text": "Checkout payment attempts fail.", "service": "checkout"},
        },
    ).json()
    expected = {
        "severity": trace["output"]["severity"],
        "route": trace["output"]["route"],
        "requires_human": trace["output"]["requires_human"],
    }

    first = client.put(
        f"/api/dataset-versions/{draft['id']}/trace-items/{trace['id']}",
        json={"expected": expected},
    )
    retry = client.put(
        f"/api/dataset-versions/{draft['id']}/trace-items/{trace['id']}",
        json={"expected": expected},
    )
    conflict = client.put(
        f"/api/dataset-versions/{draft['id']}/trace-items/{trace['id']}",
        json={"expected": {**expected, "severity": "low"}},
    )
    detail = client.get(f"/api/traces/{trace['id']}").json()
    targets = client.get(f"/api/traces/{trace['id']}/dataset-targets").json()

    assert first.status_code == 201
    assert retry.status_code == 200
    assert retry.json()["id"] == first.json()["id"]
    assert conflict.status_code == 409
    assert detail["dataset_membership_count"] == 1
    assert detail["dataset_count"] == 1
    target = next(item for item in targets["targets"] if item["dataset_version_id"] == draft["id"])
    assert target["eligible"] is False
    assert target["reason"] == "already_in_version"


def test_evaluation_origin_is_not_dataset_membership(client) -> None:
    catalog = client.get("/api/catalog").json()
    system = next(item for item in catalog["agent_systems"] if item["key"] == "incident-triage")
    dataset = next(item for item in catalog["datasets"] if item["agent_system_id"] == system["id"])
    prompt = next(item for item in catalog["prompts"] if item["agent_system_id"] == system["id"])
    final_version = next(item for item in dataset["versions"] if item["status"] == "final")
    run = client.post(
        "/api/eval-runs",
        json={
            "dataset_version_id": final_version["id"],
            "agent_system_version_id": system["versions"][0]["id"],
            "prompt_version_id": prompt["versions"][0]["id"],
            "model_ids": ["mock/incident-specialist"],
            "run_in_background": False,
        },
    ).json()
    assert run["item_results"]
    trace_id = run["item_results"][0]["trace_id"]
    trace = client.get(f"/api/traces/{trace_id}").json()
    targets = client.get(f"/api/traces/{trace_id}/dataset-targets").json()

    assert trace["origin_type"] == "evaluation"
    assert trace["evaluation_run_id"] == run["id"]
    assert trace["dataset_membership_count"] == 0
    assert targets["evaluation_expected"] == run["item_results"][0]["expected"]
    assert "evaluation_origin" in targets["targets"][0]["warnings"]


def test_cross_system_evaluation_selection_is_rejected(client, session_factory) -> None:
    session = session_factory()
    _, _, portfolio_dataset_version = ensure_seed_data(session)
    catalog = client.get("/api/catalog").json()
    incident = next(item for item in catalog["agent_systems"] if item["key"] == "incident-triage")
    incident_prompt = next(
        item for item in catalog["prompts"] if item["agent_system_id"] == incident["id"]
    )

    response = client.post(
        "/api/eval-runs",
        json={
            "dataset_version_id": portfolio_dataset_version.id,
            "agent_system_version_id": incident["versions"][0]["id"],
            "prompt_version_id": incident_prompt["versions"][0]["id"],
            "model_ids": ["mock/portfolio-analyst"],
            "run_in_background": False,
        },
    )

    assert response.status_code == 400
    assert "another agent system" in response.json()["detail"]


def test_database_rejects_insert_after_dataset_finalization(session_factory) -> None:
    session = session_factory()
    final_version = (
        session.query(DatasetVersionRecord).filter_by(status=DatasetStatus.FINAL).first()
    )
    session.add(
        DatasetItemRecord(
            dataset_version_id=final_version.id,
            input={"text": "stale write"},
            expected={"severity": "low"},
        )
    )

    with pytest.raises(IntegrityError, match="dataset_version_not_draft"):
        session.commit()
