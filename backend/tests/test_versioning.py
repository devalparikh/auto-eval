from copy import deepcopy

import pytest

from autoeval_api.agent_systems.portfolio_query.definition import PORTFOLIO_QUERY_GRAPH
from autoeval_api.agent_systems.portfolio_query.seed import (
    ensure_seed_data as ensure_query_seed_data,
)
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


@pytest.mark.parametrize(
    ("policy_patch", "error"),
    (
        (
            {"product_key": "incident-triage"},
            "Resource consumer portfolio-query does not belong to incident-triage",
        ),
        (
            {"producer_system_key": "incident-triage"},
            "Resource producer and consumer must belong to the same product",
        ),
        (
            {"producer_node_id": "normalize_portfolio"},
            "Resource producer node has no snapshot contract: normalize_portfolio",
        ),
        (
            {"producer_output_key": "wrong_output"},
            "Resource producer snapshot contract does not match: persist_portfolio_snapshot",
        ),
    ),
)
def test_graph_resource_policy_must_match_registered_producer_contract(
    session_factory,
    policy_patch,
    error,
) -> None:
    session = session_factory()
    ensure_query_seed_data(session)
    system = session.query(AgentSystemRecord).filter_by(key="portfolio-query").one()
    definition = deepcopy(PORTFOLIO_QUERY_GRAPH)
    resource_node = next(
        node for node in definition["nodes"] if node["id"] == "get_indexed_portfolio"
    )
    resource_node["resource_policy"].update(policy_patch)

    with pytest.raises(ValueError, match=error):
        create_agent_version(session, system, definition)
