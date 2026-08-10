from copy import deepcopy

from autoeval_api.models import AgentSystemRecord, PromptRecord, PromptVersionRecord
from autoeval_api.seed import INCIDENT_GRAPH
from autoeval_api.services.versioning import create_agent_version, create_prompt_version


def _multi_prompt_graph() -> dict:
    definition = deepcopy(INCIDENT_GRAPH)
    for node in definition["nodes"]:
        if node["id"] == "classify_incident":
            node["prompt_key"] = "incident-triage-system"
        if node["id"] == "draft_response":
            node["prompt_key"] = "incident-draft-response"
    return definition


def test_artifact_catalog_and_detail_expose_node_prompt_associations(
    client,
    session_factory,
) -> None:
    session = session_factory()
    owner = session.query(AgentSystemRecord).filter_by(key="incident-triage").one()
    draft_prompt = PromptRecord(
        agent_system_id=owner.id,
        key="incident-draft-response",
        name="Incident draft response",
        description="Draft-only instructions.",
    )
    session.add(draft_prompt)
    session.commit()
    draft_version = create_prompt_version(session, draft_prompt, "Draft a concise response JSON.")
    graph_version = create_agent_version(session, owner, _multi_prompt_graph())
    owner_id = owner.id
    graph_version_id = graph_version.id
    session.close()

    catalog_response = client.get(f"/api/agent-systems/{owner_id}/artifacts")
    detail_response = client.get(f"/api/artifacts/graph/{graph_version_id}")

    assert catalog_response.status_code == 200
    kinds = {artifact["kind"] for artifact in catalog_response.json()["artifacts"]}
    assert {"graph", "prompt", "dataset"} <= kinds
    assert detail_response.status_code == 200
    detail = detail_response.json()
    bindings = {item["node_id"]: item for item in detail["node_prompt_bindings"]}
    assert bindings["classify_incident"]["prompt_key"] == "incident-triage-system"
    assert bindings["draft_response"]["prompt_key"] == "incident-draft-response"
    assert bindings["draft_response"]["current_prompt_version_id"] == draft_version.id
    assert bindings["draft_response"]["available_versions"][0]["id"] == draft_version.id


def test_trace_run_resolves_and_persists_exact_prompt_versions_per_node(
    client,
    session_factory,
) -> None:
    session = session_factory()
    owner = session.query(AgentSystemRecord).filter_by(key="incident-triage").one()
    default_prompt = session.query(PromptRecord).filter_by(key="incident-triage-system").one()
    classify_v1 = (
        session.query(PromptVersionRecord)
        .filter_by(prompt_id=default_prompt.id)
        .order_by(PromptVersionRecord.version)
        .first()
    )
    create_prompt_version(session, default_prompt, "A newer classifier prompt.")
    draft_prompt = PromptRecord(
        agent_system_id=owner.id,
        key="incident-draft-response",
        name="Incident draft response",
        description="Draft-only instructions.",
    )
    session.add(draft_prompt)
    session.commit()
    draft_version = create_prompt_version(session, draft_prompt, "Draft a concise response JSON.")
    graph_version = create_agent_version(session, owner, _multi_prompt_graph())
    session.close()

    response = client.post(
        "/api/traces/run",
        json={
            "agent_system_id": owner.id,
            "agent_system_version_id": graph_version.id,
            "model_id": "mock/incident-specialist",
            "prompt_version_ids": {
                "incident-triage-system": classify_v1.id,
                "incident-draft-response": draft_version.id,
            },
            "input": {
                "text": "Checkout payment attempts fail for every customer.",
                "service": "checkout",
            },
        },
    )

    assert response.status_code == 201
    trace = response.json()
    assert trace["prompt_version_ids"] == {
        "incident-triage-system": classify_v1.id,
        "incident-draft-response": draft_version.id,
    }
    llm_spans = {span["node_id"]: span for span in trace["spans"] if span["node_kind"] == "llm"}
    assert llm_spans["classify_incident"]["prompt_version_id"] == classify_v1.id
    assert llm_spans["draft_response"]["prompt_version_id"] == draft_version.id
    assert llm_spans["classify_incident"]["system_prompt"] != "A newer classifier prompt."


def test_graph_version_rejects_prompt_keys_owned_by_another_system(
    client,
    session_factory,
) -> None:
    session = session_factory()
    owner = session.query(AgentSystemRecord).filter_by(key="incident-triage").one()
    graph = _multi_prompt_graph()
    graph["nodes"][1]["prompt_key"] = "not-an-owned-prompt"
    owner_id = owner.id
    session.close()

    response = client.post(
        f"/api/agent-systems/{owner_id}/versions",
        json={"definition": graph},
    )

    assert response.status_code == 409
    assert "must belong to this agent system" in response.json()["detail"]
