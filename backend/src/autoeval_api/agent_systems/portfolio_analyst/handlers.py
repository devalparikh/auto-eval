from collections import defaultdict
from typing import Any

from autoeval_api.graph.registry import NodeHandlerRegistry
from autoeval_api.inference.base import InferenceResponse

REQUIRED_PROFILE_FIELDS = ("goal", "time_horizon_years", "risk_tolerance", "liquidity_need")


def register_handlers(registry: NodeHandlerRegistry) -> None:
    registry.register_deterministic("normalize_portfolio", normalize_portfolio)
    registry.register_deterministic("validate_portfolio_context", validate_context)
    registry.register_deterministic("calculate_portfolio_exposure", calculate_exposure)
    registry.register_deterministic("apply_financial_safety", apply_financial_safety)
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
