from typing import Any

from autoeval_api.agent_systems.portfolio_query.covered_call import bucket_weights
from autoeval_api.coerce import integer, number, round_amount

MODEL_QUESTION_MAX_CHARS = 600


def model_candidate(value: dict[str, Any], *, include_symbol: bool) -> dict[str, Any]:
    metrics = value.get("metrics", {}) if isinstance(value.get("metrics"), dict) else {}
    candidate = {
        "candidate_id": str(value.get("candidate_id", "")),
        "option_type": str(value.get("option_type", "")),
        "expiry": str(value.get("expiry", "")),
        "dte": value.get("dte"),
        "strike": value.get("strike"),
        "bid": value.get("bid"),
        "ask": value.get("ask"),
        "delta": value.get("delta"),
        "rank": value.get("rank"),
        "metrics": {
            key: metrics.get(key)
            for key in (
                "premium_yield",
                "strike_upside",
                "downside_cushion",
                "effective_sale_price",
                "spread_ratio",
            )
        },
        "policy_checks": [
            {
                "key": str(item.get("key", "")),
                "passed": bool(item.get("passed")),
            }
            for item in value.get("policy_checks", [])
            if isinstance(item, dict)
        ],
    }
    if include_symbol:
        candidate["symbol"] = str(value.get("symbol", ""))
    return candidate


def model_portfolio_facts(value: Any, *, is_synthetic: bool) -> dict[str, Any]:
    if not is_synthetic or not isinstance(value, dict):
        return {}
    bucket_weights_value = value.get("bucket_weights", {})
    position_facts = value.get("position_facts", [])
    return {
        "position_count": integer(value.get("position_count")),
        "largest_symbol": str(value.get("largest_symbol", "")),
        "largest_weight": number(value.get("largest_weight")),
        "bucket_weights": {str(key): number(weight) for key, weight in bucket_weights_value.items()}
        if isinstance(bucket_weights_value, dict)
        else {},
        "position_facts": [
            {
                "fact_id": str(item.get("fact_id", "")),
                "symbol": str(item.get("symbol", "")),
                "instrument_type": str(item.get("instrument_type", "unknown")),
                "shares": max(0, integer(item.get("shares"))),
                "pledged_shares": max(0, integer(item.get("pledged_shares"))),
                "weight": number(item.get("weight")),
                "bucket": str(item.get("bucket", "unassigned")),
                "tags": [str(tag) for tag in item.get("tags", []) if isinstance(tag, str)],
                "covered_calls_allowed": bool(item.get("covered_calls_allowed")),
                "assignment_acceptable": bool(item.get("assignment_acceptable")),
                "do_not_touch": bool(item.get("do_not_touch")),
            }
            for item in position_facts
            if isinstance(item, dict) and item.get("fact_id")
        ],
    }


def model_safety(value: Any) -> dict[str, bool]:
    if not isinstance(value, dict):
        return {}
    return {
        key: bool(value.get(key))
        for key in (
            "market_data_fresh",
            "fully_covered",
            "assignment_acknowledgement_required",
        )
    }


def bounded_question(value: Any) -> str:
    normalized = " ".join(str(value or "").split())
    return normalized[:MODEL_QUESTION_MAX_CHARS]


def portfolio_facts(
    positions: list[dict[str, Any]], *, include_position_facts: bool = False
) -> dict[str, Any]:
    ordered = sorted(positions, key=lambda item: number(item.get("weight")), reverse=True)
    facts = {
        "position_count": len(positions),
        "largest_symbol": str(ordered[0].get("symbol")) if ordered else None,
        "largest_weight": round_amount(number(ordered[0].get("weight"))) if ordered else 0,
        "bucket_weights": bucket_weights(positions),
    }
    if include_position_facts:
        facts["position_facts"] = [
            _synthetic_position_fact(item, index) for index, item in enumerate(positions)
        ]
    return facts


def _synthetic_position_fact(value: dict[str, Any], index: int) -> dict[str, Any]:
    position_id = str(value.get("position_id") or f"position-{index + 1}")
    return {
        "fact_id": f"position:{position_id}",
        "symbol": str(value.get("symbol", "")),
        "instrument_type": str(value.get("instrument_type", "unknown")),
        "shares": max(0, integer(value.get("shares"))),
        "pledged_shares": max(0, integer(value.get("pledged_shares"))),
        "weight": round_amount(number(value.get("weight"))),
        "bucket": str(value.get("bucket", "unassigned")),
        "tags": [str(item) for item in value.get("tags", []) if isinstance(item, str)],
        "covered_calls_allowed": bool(value.get("covered_calls_allowed")),
        "assignment_acceptable": bool(value.get("assignment_acceptable")),
        "do_not_touch": bool(value.get("do_not_touch")),
    }
