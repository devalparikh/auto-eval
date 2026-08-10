from copy import deepcopy

from autoeval_api.agent_systems.portfolio_query.definition import (
    PORTFOLIO_QUERY_INPUT_TEMPLATE,
)
from autoeval_api.agent_systems.portfolio_query.handlers import (
    calculate_portfolio_answer,
    normalize_portfolio_query,
    validate_portfolio_query,
)
from autoeval_api.agent_systems.portfolio_query.snapshot import snapshot_content_hash
from autoeval_api.agent_systems.portfolio_query.trace_policy import (
    project_inference_payload,
)


def analysis_for(request_input: dict) -> dict:
    state = {"input": request_input}
    state.update(normalize_portfolio_query(state))
    state.update(validate_portfolio_query(state))
    state.update(calculate_portfolio_answer(state))
    return state


def test_covered_call_rejects_put_contracts():
    request_input = deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE)
    request_input["market_context"]["contracts"] = request_input["market_context"]["contracts"][:1]
    request_input["market_context"]["contracts"][0]["option_type"] = "put"

    analysis = analysis_for(request_input)["query_analysis"]

    assert analysis["status"] == "blocked"
    assert analysis["candidates"] == []
    assert "call_option" in analysis["blocked_reasons"]
    assert analysis["safety"]["fully_covered"] is False


def test_duplicate_symbol_lots_preserve_eligible_sleeve():
    request_input = deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE)
    request_input["snapshot"]["positions"].append(
        {
            "symbol": "NVDA",
            "instrument_type": "equity",
            "shares": 500,
            "pledged_shares": 0,
            "weight": 0.2,
            "bucket": "core",
            "covered_calls_allowed": False,
            "assignment_acceptable": False,
            "do_not_touch": True,
        }
    )
    request_input["snapshot"]["content_hash"] = snapshot_content_hash(request_input["snapshot"])

    analysis = analysis_for(request_input)["query_analysis"]

    assert analysis["status"] == "candidates"
    assert analysis["candidates"][0]["contract_id"] == "NVDA_SYNTH_CALL_160"
    assert analysis["candidates"][0]["assignment_impact"]["buckets"] == ["tactical"]


def test_snapshot_content_hash_is_verified():
    request_input = deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE)
    request_input["snapshot"]["positions"][0]["shares"] += 1

    state = {"input": request_input}
    state.update(normalize_portfolio_query(state))
    validation = validate_portfolio_query(state)["query_status"]

    assert validation["ready"] is False
    assert "snapshot.content_hash_mismatch" in validation["missing_fields"]


def test_provider_projection_contains_only_sanitized_analysis():
    state = analysis_for(deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE))

    projected = project_inference_payload(state)
    serialized = str(projected)

    assert set(projected) == {"query_analysis"}
    assert "Which supplied covered-call" not in serialized
    assert "synthetic-indexed-portfolio-v1" not in serialized
    assert "'symbol':" not in serialized
    assert "'shares':" not in serialized
    assert "'weight':" not in serialized
    assert "'gross_premium_usd':" not in serialized
