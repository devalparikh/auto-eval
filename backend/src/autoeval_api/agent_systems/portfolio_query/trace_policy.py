from copy import deepcopy
from typing import Any

SENSITIVE_KEYS = {
    "account_id",
    "account_name",
    "cost_basis",
    "contracts",
    "gross_premium_usd",
    "market_value",
    "min_exit_price",
    "name",
    "owner",
    "pledged_shares",
    "positions",
    "question",
    "quantity",
    "shares",
    "shares_after_assignment",
    "symbol",
    "tags",
    "value",
    "weight",
    "bucket_weights",
    "largest_symbol",
    "largest_weight",
}


def project_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return _redact(payload)


def project_inference_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Allowlist only deterministic analysis needed by the explanation node."""
    analysis = payload.get("query_analysis")
    if not isinstance(analysis, dict):
        return {"query_analysis": {}}
    return {
        "query_analysis": {
            "intent": analysis.get("intent"),
            "status": analysis.get("status"),
            "blocked_reasons": _string_list(analysis.get("blocked_reasons")),
            "portfolio_facts": _portfolio_facts(analysis.get("portfolio_facts")),
            "candidates": [
                _candidate(item)
                for item in analysis.get("candidates", [])
                if isinstance(item, dict)
            ],
            "safety": _redact(analysis.get("safety", {})),
        }
    }


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _redact(item) for key, item in value.items() if key.lower() not in SENSITIVE_KEYS
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return deepcopy(value)


def _candidate(value: dict[str, Any]) -> dict[str, Any]:
    metrics = value.get("metrics", {}) if isinstance(value.get("metrics"), dict) else {}
    return {
        "contract_id": str(value.get("contract_id", "")),
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
        "policy_checks": _redact(value.get("policy_checks", [])),
    }


def _portfolio_facts(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return {"position_count": value.get("position_count")}


def _string_list(value: Any) -> list[str]:
    return [str(item) for item in value] if isinstance(value, list) else []
