from math import floor
from typing import Any

from autoeval_api.coerce import integer, number, optional_integer, optional_number, round_amount


def covered_call_candidate(
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
    shares = sum(max(0, integer(item.get("shares"))) for item in eligible_lots)
    pledged = sum(max(0, integer(item.get("pledged_shares"))) for item in eligible_lots)
    multiplier = max(1, integer(contract.get("multiplier"), 100))
    available_contracts = floor(max(0, shares - pledged) / multiplier)
    bid = number(contract.get("bid"))
    ask = number(contract.get("ask"))
    midpoint = (bid + ask) / 2 if bid + ask > 0 else 0
    spread_ratio = (ask - bid) / midpoint if midpoint > 0 else 1
    underlying = number(contract.get("underlying_price"))
    strike = number(contract.get("strike"))
    strike_upside = (strike - underlying) / underlying if underlying > 0 else -1
    delta_value = optional_number(contract.get("delta"))
    delta = abs(delta_value) if delta_value is not None else 0
    open_interest = optional_integer(contract.get("open_interest"))
    event_data_known = contract.get("event_data_known") is True
    greeks_age_hours = optional_number(contract.get("greeks_age_hours"))
    min_exit_price = max(
        (number(item.get("min_exit_price")) for item in eligible_lots),
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
        "dte_in_range": policy["min_dte"] <= integer(contract.get("dte")) <= policy["max_dte"],
        "delta_available": delta_value is not None,
        "greeks_fresh": delta_value is not None
        and greeks_age_hours is not None
        and 0 <= greeks_age_hours <= policy["max_greeks_age_hours"],
        "delta_in_range": delta_value is not None
        and policy["min_delta"] <= delta <= policy["max_delta"],
        "open_interest_available": open_interest is not None,
        "liquid_open_interest": open_interest is not None
        and open_interest >= policy["min_open_interest"],
        "underlying_price_valid": underlying > 0,
        "quote_values_valid": 0 < bid <= ask,
        "quote_timestamp_available": contract.get("quote_timestamp_available") is True,
        "underlying_timestamp_available": contract.get("underlying_timestamp_available") is True,
        "spread_in_range": 0 < bid <= ask
        and 0 <= spread_ratio <= policy["max_bid_ask_spread_ratio"],
        "strike_upside_in_range": strike_upside >= policy["min_strike_upside"],
        "exit_floor_met": strike >= min_exit_price,
        "event_data_known": not policy["earnings_blackout"] or event_data_known,
        "event_policy_met": not policy["earnings_blackout"]
        or (event_data_known and contract.get("earnings_before_expiry") is False),
        "valid_bid": bid > 0,
    }
    failures.extend(key for key, passed in checks.items() if not passed)
    if failures:
        return None, failures
    contracts = min(available_contracts, policy["max_contracts_per_symbol"])
    premium_yield = bid / underlying if underlying > 0 else 0
    return (
        {
            "provider_contract_id": str(contract.get("provider_contract_id", "unknown")),
            "symbol": str(contract.get("symbol", "")).upper(),
            "option_type": "call",
            "expiry": str(contract.get("expiry", "unknown")),
            "dte": integer(contract.get("dte")),
            "strike": round_amount(strike),
            "bid": round_amount(bid),
            "ask": round_amount(ask),
            "delta": round_amount(delta),
            "contracts": contracts,
            "metrics": {
                "gross_premium_usd": round_amount(bid * multiplier * contracts),
                "premium_yield": round_amount(premium_yield),
                "strike_upside": round_amount(strike_upside),
                "downside_cushion": round_amount(premium_yield),
                "effective_sale_price": round_amount(strike + bid),
                "spread_ratio": round_amount(spread_ratio),
            },
            "assignment_impact": {
                "shares_after_assignment": shares - multiplier * contracts,
                "remaining_position_weight_estimate": round_amount(
                    sum(number(item.get("weight")) for item in eligible_lots)
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


def safety(status: dict[str, Any], candidates: list[dict[str, Any]]) -> dict[str, Any]:
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


def bucket_weights(positions: list[dict[str, Any]]) -> dict[str, float]:
    weights: dict[str, float] = {}
    for position in positions:
        bucket = str(position.get("bucket", "unassigned"))
        weights[bucket] = weights.get(bucket, 0) + number(position.get("weight"))
    return {key: round_amount(value) for key, value in sorted(weights.items())}


def positions_by_symbol(
    positions: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for position in positions:
        symbol = str(position.get("symbol", "")).upper()
        if symbol:
            grouped.setdefault(symbol, []).append(position)
    return grouped


def normalized_policy(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "min_dte": integer(value.get("min_dte"), 21),
        "max_dte": integer(value.get("max_dte"), 45),
        "min_delta": number(value.get("min_delta"), 0.15),
        "max_delta": number(value.get("max_delta"), 0.3),
        "target_delta": number(value.get("target_delta"), 0.2),
        "min_open_interest": integer(value.get("min_open_interest"), 500),
        "max_bid_ask_spread_ratio": number(value.get("max_bid_ask_spread_ratio"), 0.12),
        "min_strike_upside": number(value.get("min_strike_upside"), 0.05),
        "max_quote_age_hours": number(value.get("max_quote_age_hours"), 24),
        "max_greeks_age_hours": number(value.get("max_greeks_age_hours"), 4),
        "earnings_blackout": bool(value.get("earnings_blackout", True)),
        "max_contracts_per_symbol": max(1, integer(value.get("max_contracts_per_symbol"), 1)),
    }
