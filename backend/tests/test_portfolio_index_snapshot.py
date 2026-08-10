from copy import deepcopy

from autoeval_api.agent_systems.portfolio_analyst.definition import PORTFOLIO_INPUT_TEMPLATE
from autoeval_api.agent_systems.portfolio_analyst.handlers import (
    calculate_exposure,
    normalize_portfolio,
    persist_portfolio_snapshot,
    validate_context,
)
from autoeval_api.agent_systems.portfolio_analyst.seed import ensure_seed_data
from autoeval_api.graph.context import GraphRuntimeContext
from autoeval_api.models import PortfolioSnapshotRecord, PromptRecord


def test_index_flow_persists_an_immutable_snapshot_reference(session_factory) -> None:
    session = session_factory()
    try:
        ensure_seed_data(session)
        request_input = deepcopy(PORTFOLIO_INPUT_TEMPLATE)
        request_input["snapshot_label"] = "Synthetic test index"
        request_input["profile"]["name"] = "Synthetic owner"
        request_input["holdings"][0]["account_id"] = "synthetic-account"
        request_input["holdings"][0]["value"] = 125_000
        state = {"input": request_input}
        state.update(normalize_portfolio(state))
        state.update(validate_context(state))
        state.update(calculate_exposure(state))
        state["output"] = {"analysis_ready": True}

        first = persist_portfolio_snapshot(
            state,
            GraphRuntimeContext(session, "portfolio-analyst"),
        )["output"]["portfolio_snapshot"]
        second = persist_portfolio_snapshot(
            state,
            GraphRuntimeContext(session, "portfolio-analyst"),
        )["output"]["portfolio_snapshot"]

        record = session.get(PortfolioSnapshotRecord, first["id"])
        assert first == second
        assert record is not None
        assert record.label == "Synthetic test index"
        assert record.is_synthetic is True
        assert record.document["positions"][0]["symbol"] == "BROAD_MARKET"
        assert record.document["derived_analysis"]["analysis_ready"] is True
        assert "name" not in record.document["profile"]
        assert "account_id" not in record.document["positions"][0]
        assert "value" not in record.document["positions"][0]
    finally:
        session.close()


def test_index_graph_uses_separate_prompt_families_for_llm_nodes(session_factory) -> None:
    session = session_factory()
    try:
        graph, _, _ = ensure_seed_data(session)
        llm_prompt_keys = {
            node.get("prompt_key") for node in graph.definition["nodes"] if node["kind"] == "llm"
        }
        owner_prompt_keys = {
            prompt.key
            for prompt in session.query(PromptRecord)
            .filter_by(agent_system_id=graph.agent_system_id)
            .all()
        }

        assert llm_prompt_keys == {
            "portfolio-index-context-extraction",
            "portfolio-index-explanation",
        }
        assert llm_prompt_keys <= owner_prompt_keys
        assert "portfolio-analyst-system" in owner_prompt_keys
    finally:
        session.close()
