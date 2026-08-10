from autoeval_api.agent_systems.incident_triage.seed import ensure_seed_data
from autoeval_api.models import (
    AgentSystemRecord,
    AgentSystemVersionRecord,
    DatasetItemRecord,
    DatasetRecord,
    DatasetVersionRecord,
    PromptRecord,
    PromptVersionRecord,
)


def test_seed_data_is_idempotent(session_factory) -> None:
    session = session_factory()
    first_ids = tuple(record.id for record in ensure_seed_data(session))
    second_ids = tuple(record.id for record in ensure_seed_data(session))

    assert first_ids == second_ids
    assert session.query(AgentSystemRecord).count() == 1
    assert session.query(AgentSystemVersionRecord).count() == 1
    assert session.query(PromptRecord).count() == 3
    assert session.query(PromptVersionRecord).count() == 3
    assert session.query(DatasetRecord).count() == 1
    assert session.query(DatasetVersionRecord).count() == 2
    assert session.query(DatasetItemRecord).count() == 12
    graph = session.query(AgentSystemVersionRecord).one()
    assert {
        node.get("prompt_key") for node in graph.definition["nodes"] if node["kind"] == "llm"
    } == {
        "incident-triage-classification",
        "incident-triage-draft-response",
    }
