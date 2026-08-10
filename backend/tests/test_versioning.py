import pytest

from autoeval_api.models import AgentSystemRecord, AgentSystemVersionRecord, PromptRecord
from autoeval_api.seed import INCIDENT_GRAPH
from autoeval_api.services.versioning import (
    create_agent_version,
    create_prompt_version,
    latest_prompt_version,
)


def test_graph_change_creates_new_version(session_factory) -> None:
    session = session_factory()
    system = session.query(AgentSystemRecord).filter_by(key="incident-triage").one()
    changed = {**INCIDENT_GRAPH, "nodes": [*INCIDENT_GRAPH["nodes"]]}
    changed["nodes"] = [dict(node) for node in changed["nodes"]]
    changed["nodes"][0]["label"] = "Normalize request input"

    version = create_agent_version(session, system, changed)

    assert version.version == 2
    assert session.query(AgentSystemVersionRecord).count() == 2


def test_duplicate_prompt_content_is_rejected(session_factory) -> None:
    session = session_factory()
    prompt = session.query(PromptRecord).filter_by(key="incident-triage-system").one()
    content = prompt and session.query(prompt.__class__).first()
    existing_content = session.query(prompt.__class__).first()
    assert content is not None
    from autoeval_api.models import PromptVersionRecord

    prompt_version = session.query(PromptVersionRecord).filter_by(prompt_id=prompt.id).one()
    with pytest.raises(ValueError, match="already exists"):
        create_prompt_version(session, prompt, prompt_version.content)
    assert existing_content is not None


def test_legacy_default_prompt_remains_the_primary_system_prompt(session_factory) -> None:
    session = session_factory()
    system = session.query(AgentSystemRecord).filter_by(key="incident-triage").one()

    version = latest_prompt_version(session, system.id)
    prompt = session.get(PromptRecord, version.prompt_id)

    assert prompt.key == "incident-triage-system"
