from collections import defaultdict
from copy import deepcopy
from typing import Any

from autoeval_api.agent_systems.portfolio_query.snapshot import snapshot_content_hash
from autoeval_api.graph.context import GraphRuntimeContext
from autoeval_api.graph.registry import NodeHandlerRegistry
from autoeval_api.inference.base import InferenceResponse
from autoeval_api.models import AgentSystemRecord, utc_now
from autoeval_api.services.portfolio_snapshots import create_portfolio_snapshot

REQUIRED_PROFILE_FIELDS = ("goal", "time_horizon_years", "risk_tolerance", "liquidity_need")
SNAPSHOT_PROFILE_FIELDS = REQUIRED_PROFILE_FIELDS
SNAPSHOT_POSITION_FIELDS = (
    "symbol",
    "instrument_type",
    "asset_class",
    "bucket",
    "weight",
    "shares",
    "pledged_shares",
    "covered_calls_allowed",
    "assignment_acceptable",
    "do_not_touch",
    "min_exit_price",
    "tags",
    "exposures",
)


def register_handlers(registry: NodeHandlerRegistry) -> None:
    registry.register_deterministic("normalize_portfolio", normalize_portfolio)
    registry.register_deterministic("validate_portfolio_context", validate_context)
    registry.register_deterministic("calculate_portfolio_exposure", calculate_exposure)
    registry.register_deterministic("apply_financial_safety", apply_financial_safety)
    registry.register_contextual_deterministic(
        "persist_portfolio_snapshot", persist_portfolio_snapshot
    )
    registry.register_llm_output("merge_portfolio_context", merge_inference_output)
    registry.register_llm_output("merge_portfolio_explanation", merge_inference_output)


def normalize_portfolio(state: dict[str, Any]) -> dict[str, Any]:
    request = state.get("input", {})
    profile = request.get("profile", {}) if isinstance(request.get("profile"), dict) else {}
    raw_holdings = request.get("holdings", [])
    holdings = []
    if isinstance(raw_holdings, list):
        for raw in raw_holdings:
            if not isinstance(raw, dict):
                continue
            weight = _number(raw.get("weight"))
            holdings.append(
                {
                    **raw,
                    "symbol": str(raw.get("symbol", "UNKNOWN")).upper(),
                    "asset_class": str(raw.get("asset_class", "unknown")),
                    "bucket": str(raw.get("bucket", "unassigned")),
                    "weight": max(0.0, weight),
                    "exposures": (
                        raw.get("exposures", {}) if isinstance(raw.get("exposures"), dict) else {}
                    ),
                }
            )
    total_weight = sum(item["weight"] for item in holdings)
    if total_weight > 0:
        for holding in holdings:
            holding["weight"] = holding["weight"] / total_weight
    return {
        "normalized": {
            "is_synthetic": bool(request.get("is_synthetic", False)),
            "profile": profile,
            "holdings": holdings,
            "bucket_policies": _dict_list(request.get("bucket_policies")),
            "scenarios": _dict_list(request.get("scenarios")),
        }
    }


def validate_context(state: dict[str, Any]) -> dict[str, Any]:
    normalized = state.get("normalized", {})
    profile = normalized.get("profile", {})
    missing = [f"profile.{key}" for key in REQUIRED_PROFILE_FIELDS if not profile.get(key)]
    if not normalized.get("holdings"):
        missing.append("holdings")
    questions = {
        "profile.goal": "What outcome should this portfolio support?",
        "profile.time_horizon_years": "How many years until you expect to use this capital?",
        "profile.risk_tolerance": "How much drawdown could you tolerate without changing plan?",
        "profile.liquidity_need": "What near-term liquidity does the portfolio need to provide?",
        "holdings": "Which holdings and approximate portfolio weights should I analyze?",
    }
    return {
        "context_status": {
            "complete": not missing,
            "missing_fields": missing,
            "next_question": questions.get(missing[0]) if missing else None,
        }
    }


def calculate_exposure(state: dict[str, Any]) -> dict[str, Any]:
    status = state.get("context_status", {})
    if not status.get("complete"):
        return {
            "analysis": {
                "analysis_ready": False,
                "missing_fields": status.get("missing_fields", []),
                "next_question": status.get("next_question"),
            }
        }

    normalized = state["normalized"]
    holdings = normalized["holdings"]
    asset_allocation = _group_weights(holdings, "asset_class")
    bucket_allocation = _group_weights(holdings, "bucket")
    ordered = sorted(holdings, key=lambda item: item["weight"], reverse=True)
    hhi = sum(item["weight"] ** 2 for item in holdings)
    concentration_flags = [
        {"symbol": item["symbol"], "weight": _round(item["weight"])}
        for item in ordered
        if item["weight"] > 0.15
    ]
    bucket_gaps = _bucket_gaps(bucket_allocation, normalized["bucket_policies"])
    scenarios = [_scenario_result(holdings, scenario) for scenario in normalized["scenarios"]]
    return {
        "analysis": {
            "analysis_ready": True,
            "metrics": {
                "top_holding_symbol": ordered[0]["symbol"],
                "top_holding_weight": _round(ordered[0]["weight"]),
                "concentration_hhi": _round(hhi),
                "effective_holdings": _round(1 / hhi) if hhi else 0,
                "concentration_flags": concentration_flags,
                "asset_allocation": asset_allocation,
                "bucket_allocation": bucket_allocation,
                "bucket_gaps": bucket_gaps,
                "liquidity_weight": asset_allocation.get("cash", 0),
                "scenarios": scenarios,
            },
            "profile": normalized["profile"],
        }
    }


def apply_financial_safety(state: dict[str, Any]) -> dict[str, Any]:
    explanation = state.get("portfolio_explanation", {})
    analysis = state.get("analysis", {})
    output = {**analysis, **explanation}
    output.pop("recommended_trades", None)
    output["disclaimer"] = (
        "Analytical support only. Review assumptions and decisions with a qualified professional."
    )
    return {"output": output}


def persist_portfolio_snapshot(
    state: dict[str, Any], context: GraphRuntimeContext
) -> dict[str, Any]:
    """Publish an index-flow result as an immutable domain snapshot."""
    output = deepcopy(state.get("output", {}))
    analysis = state.get("analysis", {})
    normalized = state.get("normalized", {})
    holdings = normalized.get("holdings", [])
    if not analysis.get("analysis_ready") or not isinstance(holdings, list) or not holdings:
        return {"output": output}

    request = state.get("input", {})
    as_of = str(request.get("snapshot_as_of") or utc_now().isoformat())
    is_synthetic = bool(request.get("is_synthetic", False))
    positions = []
    for index, holding in enumerate(holdings):
        if not isinstance(holding, dict):
            continue
        positions.append(
            {
                "position_id": str(
                    holding.get("position_id")
                    or f"position-{index + 1}-{holding.get('symbol', 'UNKNOWN')}"
                ),
                **{
                    key: deepcopy(holding[key])
                    for key in SNAPSHOT_POSITION_FIELDS
                    if key in holding
                },
            }
        )
    profile = normalized.get("profile", {})
    profile = profile if isinstance(profile, dict) else {}
    derived_analysis = deepcopy(analysis)
    if isinstance(derived_analysis.get("profile"), dict):
        derived_analysis["profile"] = {
            key: deepcopy(derived_analysis["profile"][key])
            for key in SNAPSHOT_PROFILE_FIELDS
            if key in derived_analysis["profile"]
        }
    document = {
        "schema_version": 1,
        "as_of": as_of,
        "is_synthetic": is_synthetic,
        "profile": {
            key: deepcopy(profile[key]) for key in SNAPSHOT_PROFILE_FIELDS if key in profile
        },
        "positions": positions,
        "bucket_policies": deepcopy(normalized.get("bucket_policies", [])),
        "scenarios": deepcopy(normalized.get("scenarios", [])),
        "derived_analysis": derived_analysis,
    }
    content_hash = snapshot_content_hash(document)
    owner = context.session.query(AgentSystemRecord).filter_by(key="portfolio-analyst").one()
    snapshot = create_portfolio_snapshot(
        context.session,
        owner,
        snapshot_id=f"portfolio-{content_hash[:24]}",
        label=str(request.get("snapshot_label") or f"Indexed portfolio {as_of}"),
        as_of=as_of,
        source_kind="synthetic" if is_synthetic else "indexed_run",
        is_synthetic=is_synthetic,
        document=document,
        source_trace_id=context.trace_id,
    )
    context.bind_node_snapshot(
        "persist_portfolio_snapshot",
        snapshot.id,
        role="produced",
        resolution_mode="computed",
        metadata={
            "output_key": "portfolio_state",
            "schema_version": snapshot.schema_version,
            "content_hash": snapshot.content_hash,
            "is_synthetic": snapshot.is_synthetic,
            "position_count": len(positions),
        },
    )
    output["portfolio_snapshot"] = {
        "id": snapshot.id,
        "content_hash": snapshot.content_hash,
        "as_of": snapshot.as_of,
        "is_synthetic": snapshot.is_synthetic,
    }
    return {"output": output}


def merge_inference_output(_state: dict[str, Any], response: InferenceResponse) -> dict[str, Any]:
    return response.output


def _group_weights(holdings: list[dict[str, Any]], key: str) -> dict[str, float]:
    grouped: dict[str, float] = defaultdict(float)
    for holding in holdings:
        grouped[str(holding[key])] += holding["weight"]
    return {name: _round(weight) for name, weight in sorted(grouped.items())}


def _bucket_gaps(
    allocation: dict[str, float], policies: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    gaps = []
    for policy in policies:
        key = str(policy.get("key", "unassigned"))
        actual = allocation.get(key, 0)
        minimum = _number(policy.get("min_weight"))
        maximum = _number(policy.get("max_weight", 1))
        status = "within"
        if actual < minimum:
            status = "below"
        elif actual > maximum:
            status = "above"
        gaps.append(
            {
                "bucket": key,
                "actual_weight": _round(actual),
                "min_weight": _round(minimum),
                "max_weight": _round(maximum),
                "status": status,
            }
        )
    return gaps


def _scenario_result(holdings: list[dict[str, Any]], scenario: dict[str, Any]) -> dict[str, Any]:
    shocks = scenario.get("shocks", {}) if isinstance(scenario.get("shocks"), dict) else {}
    estimated = 0.0
    for holding in holdings:
        holding_shock = _number(shocks.get(holding["asset_class"]))
        for exposure, coefficient in holding["exposures"].items():
            holding_shock += _number(coefficient) * _number(shocks.get(exposure))
        estimated += holding["weight"] * holding_shock
    return {
        "name": str(scenario.get("name", "Scenario")),
        "estimated_return": _round(estimated),
    }


def _dict_list(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _round(value: float) -> float:
    return round(value, 6)
