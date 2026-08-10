from __future__ import annotations

from collections import Counter
from math import floor
from typing import Any

from autoeval_api.agent_systems.portfolio_query.snapshot import snapshot_content_hash
from autoeval_api.graph.registry import NodeHandlerRegistry
from autoeval_api.inference.base import InferenceResponse


def register_handlers(registry: NodeHandlerRegistry) -> None:
    registry.register_deterministic("normalize_portfolio_query", normalize_portfolio_query)
    registry.register_deterministic("validate_portfolio_query", validate_portfolio_query)
    registry.register_deterministic("calculate_portfolio_answer", calculate_portfolio_answer)
    registry.register_deterministic("apply_portfolio_query_safety", apply_portfolio_query_safety)
    registry.register_llm_output(
        "merge_portfolio_query_explanation", merge_portfolio_query_explanation
    )


def normalize_portfolio_query(state: dict[str, Any]) -> dict[str, Any]:
    request = state.get("input", {})
    question = str(request.get("question", "")).strip()
    snapshot = request.get("snapshot", {}) if isinstance(request.get("snapshot"), dict) else {}
    market = (
        request.get("market_context", {}) if isinstance(request.get("market_context"), dict) else {}
    )
    policy = request.get("policy", {}) if isinstance(request.get("policy"), dict) else {}
    lowered = question.lower()
    intent = (
        "covered_call"
        if any(
            term in lowered
            for term in ("covered call", "covered-call", "call option", "option income")
        )
        else "portfolio_question"
    )
    return {
        "normalized_query": {
            "question": question,
            "intent": intent,
            "snapshot": {
                **snapshot,
                "positions": _dict_list(snapshot.get("positions")),
            },
            "market_context": {
                **market,
                "contracts": _dict_list(market.get("contracts")),
            },
            "policy": _normalized_policy(policy),
        }
    }


def validate_portfolio_query(state: dict[str, Any]) -> dict[str, Any]:
    query = state.get("normalized_query", {})
    snapshot = query.get("snapshot", {})
    market = query.get("market_context", {})
    policy = query.get("policy", {})
    missing = []
    if not query.get("question"):
        missing.append("question")
    if not snapshot.get("id"):
        missing.append("snapshot.id")
    if not snapshot.get("content_hash"):
        missing.append("snapshot.content_hash")
    elif snapshot.get("content_hash") != snapshot_content_hash(snapshot):
        missing.append("snapshot.content_hash_mismatch")
    if not snapshot.get("positions"):
        missing.append("snapshot.positions")

    quote_age = _number(market.get("quote_age_hours"), -1)
    market_data_fresh = 0 <= quote_age <= policy["max_quote_age_hours"]
    if query.get("intent") == "covered_call" and not market.get("contracts"):
        missing.append("market_context.contracts")
    return {
        "query_status": {
            "ready": not missing,
            "missing_fields": missing,
            "market_data_fresh": market_data_fresh,
            "quote_age_hours": quote_age,
        }
    }


def calculate_portfolio_answer(state: dict[str, Any]) -> dict[str, Any]:
    query = state.get("normalized_query", {})
    status = state.get("query_status", {})
    snapshot = query.get("snapshot", {})
    reference = {
        "id": snapshot.get("id"),
        "content_hash": snapshot.get("content_hash"),
        "as_of": snapshot.get("as_of"),
        "is_synthetic": bool(snapshot.get("is_synthetic")),
    }
    if not status.get("ready"):
        return {
            "query_analysis": {
                "snapshot": reference,
                "intent": query.get("intent"),
                "status": "missing_context",
                "blocked_reasons": status.get("missing_fields", []),
                "candidates": [],
                "safety": _safety(status, []),
            }
        }
    if query.get("intent") != "covered_call":
        return {
            "query_analysis": {
                "snapshot": reference,
                "intent": "portfolio_question",
                "status": "ready",
                "portfolio_facts": _portfolio_facts(snapshot.get("positions", [])),
                "candidates": [],
                "blocked_reasons": [],
                "safety": _safety(status, []),
            }
        }
    if not status.get("market_data_fresh"):
        return {
            "query_analysis": {
                "snapshot": reference,
                "intent": "covered_call",
                "status": "needs_market_data",
                "candidates": [],
                "blocked_reasons": ["stale_option_quotes"],
                "safety": _safety(status, []),
            }
        }

    positions = _positions_by_symbol(snapshot.get("positions", []))
    policy = query["policy"]
    candidates = []
    failed_checks: Counter[str] = Counter()
    for contract in query.get("market_context", {}).get("contracts", []):
        symbol_positions = positions.get(str(contract.get("symbol", "")).upper())
        candidate, failures = _covered_call_candidate(symbol_positions, contract, policy)
        failed_checks.update(failures)
        if candidate is not None:
            candidates.append(candidate)

    candidates.sort(
        key=lambda item: (
            abs(item["delta"] - policy["target_delta"]),
            -item["metrics"]["premium_yield"],
            item["metrics"]["spread_ratio"],
            item["contract_id"],
        )
    )
    for rank, candidate in enumerate(candidates, start=1):
        candidate["rank"] = rank
    return {
        "query_analysis": {
            "snapshot": reference,
            "intent": "covered_call",
            "status": "candidates" if candidates else "blocked",
            "candidates": candidates,
            "blocked_reasons": (
                [] if candidates else [key for key, _ in failed_checks.most_common()]
            ),
            "safety": _safety(status, candidates),
        }
    }


def apply_portfolio_query_safety(state: dict[str, Any]) -> dict[str, Any]:
    analysis = state.get("query_analysis", {})
    explanation = state.get("portfolio_query_explanation", {})
    answer = explanation.get("answer", {}) if isinstance(explanation.get("answer"), dict) else {}
    output = {
        "snapshot": analysis.get("snapshot", {}),
        "query": {
            "intent": analysis.get("intent"),
            "status": analysis.get("status"),
        },
        "answer": {
            "summary": str(answer.get("summary", "Computed analysis is available below.")),
            "assumptions": _string_list(answer.get("assumptions")),
            "risks": _string_list(answer.get("risks")),
        },
        "covered_call": {
            "status": analysis.get("status"),
            "candidates": analysis.get("candidates", []),
            "blocked_reasons": analysis.get("blocked_reasons", []),
        },
        "portfolio_facts": analysis.get("portfolio_facts", {}),
        "safety": analysis.get("safety", {}),
        "disclaimer": (
            "Analytical support based only on the supplied snapshot and option data. "
            "Verify live quotes, assignment, taxes, and suitability before any transaction."
        ),
    }
    return {"output": output}


def merge_portfolio_query_explanation(
    _state: dict[str, Any], response: InferenceResponse
) -> dict[str, Any]:
    return {"portfolio_query_explanation": response.output}


def _covered_call_candidate(
    positions: list[dict[str, Any]] | None,
    contract: dict[str, Any],
    policy: dict[str, Any],
) -> tuple[dict[str, Any] | None, list[str]]:
    failures = []
    if not positions:
        return None, ["holding_not_found"]

    allowed_lots = [item for item in positions if bool(item.get("covered_calls_allowed"))]
    assignable_lots = [item for item in allowed_lots if bool(item.get("assignment_acceptable"))]
    eligible_lots = [item for item in assignable_lots if not bool(item.get("do_not_touch"))]
    shares = sum(max(0, _integer(item.get("shares"))) for item in eligible_lots)
    pledged = sum(max(0, _integer(item.get("pledged_shares"))) for item in eligible_lots)
    multiplier = max(1, _integer(contract.get("multiplier"), 100))
    available_contracts = floor(max(0, shares - pledged) / multiplier)
    bid = _number(contract.get("bid"))
    ask = _number(contract.get("ask"))
    midpoint = (bid + ask) / 2 if bid + ask > 0 else 0
    spread_ratio = (ask - bid) / midpoint if midpoint > 0 else 1
    underlying = _number(contract.get("underlying_price"))
    strike = _number(contract.get("strike"))
    strike_upside = (strike - underlying) / underlying if underlying > 0 else -1
    delta = abs(_number(contract.get("delta")))
    min_exit_price = max(
        (_number(item.get("min_exit_price")) for item in eligible_lots),
        default=0,
    )
    checks = {
        "call_option": str(contract.get("option_type", "")).lower() == "call",
        "valid_expiry": bool(str(contract.get("expiry", "")).strip()),
        "standard_contract_multiplier": multiplier == 100,
        "covered_calls_allowed": bool(allowed_lots),
        "assignment_acceptable": bool(assignable_lots),
        "not_do_not_touch": bool(eligible_lots),
        "fully_covered": available_contracts >= 1,
        "dte_in_range": policy["min_dte"] <= _integer(contract.get("dte")) <= policy["max_dte"],
        "delta_in_range": policy["min_delta"] <= delta <= policy["max_delta"],
        "liquid_open_interest": (
            _integer(contract.get("open_interest")) >= policy["min_open_interest"]
        ),
        "spread_in_range": 0 <= spread_ratio <= policy["max_bid_ask_spread_ratio"],
        "strike_upside_in_range": strike_upside >= policy["min_strike_upside"],
        "exit_floor_met": strike >= min_exit_price,
        "event_policy_met": not (
            policy["earnings_blackout"] and bool(contract.get("earnings_before_expiry"))
        ),
        "valid_bid": bid > 0,
    }
    failures.extend(key for key, passed in checks.items() if not passed)
    if failures:
        return None, failures
    contracts = min(available_contracts, policy["max_contracts_per_symbol"])
    premium_yield = bid / underlying if underlying > 0 else 0
    return (
        {
            "contract_id": str(contract.get("contract_id", "unknown")),
            "symbol": str(contract.get("symbol", "")).upper(),
            "option_type": "call",
            "expiry": str(contract.get("expiry", "unknown")),
            "dte": _integer(contract.get("dte")),
            "strike": _round(strike),
            "bid": _round(bid),
            "ask": _round(ask),
            "delta": _round(delta),
            "contracts": contracts,
            "metrics": {
                "gross_premium_usd": _round(bid * multiplier * contracts),
                "premium_yield": _round(premium_yield),
                "strike_upside": _round(strike_upside),
                "downside_cushion": _round(premium_yield),
                "effective_sale_price": _round(strike + bid),
                "spread_ratio": _round(spread_ratio),
            },
            "assignment_impact": {
                "shares_after_assignment": shares - multiplier * contracts,
                "remaining_position_weight_estimate": _round(
                    sum(_number(item.get("weight")) for item in eligible_lots)
                    * max(0, shares - multiplier * contracts)
                    / shares
                )
                if shares
                else 0,
                "buckets": sorted(
                    {str(item.get("bucket", "unassigned")) for item in eligible_lots}
                ),
            },
            "policy_checks": [{"key": key, "passed": passed} for key, passed in checks.items()],
        },
        [],
    )


def _safety(status: dict[str, Any], candidates: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "market_data_fresh": bool(status.get("market_data_fresh")),
        "fully_covered": bool(candidates)
        and all(
            any(
                check["key"] == "fully_covered" and check["passed"]
                for check in candidate.get("policy_checks", [])
            )
            for candidate in candidates
        ),
        "assignment_acknowledgement_required": bool(candidates),
    }


def _portfolio_facts(positions: list[dict[str, Any]]) -> dict[str, Any]:
    ordered = sorted(positions, key=lambda item: _number(item.get("weight")), reverse=True)
    return {
        "position_count": len(positions),
        "largest_symbol": str(ordered[0].get("symbol")) if ordered else None,
        "largest_weight": _round(_number(ordered[0].get("weight"))) if ordered else 0,
        "bucket_weights": _bucket_weights(positions),
    }


def _bucket_weights(positions: list[dict[str, Any]]) -> dict[str, float]:
    weights: dict[str, float] = {}
    for position in positions:
        bucket = str(position.get("bucket", "unassigned"))
        weights[bucket] = weights.get(bucket, 0) + _number(position.get("weight"))
    return {key: _round(value) for key, value in sorted(weights.items())}


def _positions_by_symbol(
    positions: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for position in positions:
        symbol = str(position.get("symbol", "")).upper()
        if symbol:
            grouped.setdefault(symbol, []).append(position)
    return grouped


def _normalized_policy(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "min_dte": _integer(value.get("min_dte"), 21),
        "max_dte": _integer(value.get("max_dte"), 45),
        "min_delta": _number(value.get("min_delta"), 0.15),
        "max_delta": _number(value.get("max_delta"), 0.3),
        "target_delta": _number(value.get("target_delta"), 0.2),
        "min_open_interest": _integer(value.get("min_open_interest"), 500),
        "max_bid_ask_spread_ratio": _number(value.get("max_bid_ask_spread_ratio"), 0.12),
        "min_strike_upside": _number(value.get("min_strike_upside"), 0.05),
        "max_quote_age_hours": _number(value.get("max_quote_age_hours"), 24),
        "earnings_blackout": bool(value.get("earnings_blackout", True)),
        "max_contracts_per_symbol": max(1, _integer(value.get("max_contracts_per_symbol"), 1)),
    }


def _dict_list(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _string_list(value: Any) -> list[str]:
    return [str(item) for item in value] if isinstance(value, list) else []


def _number(value: Any, default: float = 0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _integer(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _round(value: float) -> float:
    return round(value, 6)
