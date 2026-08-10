from copy import deepcopy
from typing import Any

SENSITIVE_KEYS = {
    "account_id",
    "account_name",
    "cost_basis",
    "email",
    "market_value",
    "owner",
    "quantity",
    "shares",
    "value",
}


def project_payload(payload: dict[str, Any]) -> dict[str, Any]:
    projected = _redact(payload)
    _remove_profile_names(projected)
    return projected


def project_inference_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Keep provider context to profile categories or deterministic aggregate analysis."""
    analysis = payload.get("analysis")
    if isinstance(analysis, dict):
        projected_analysis = _redact(analysis)
        metrics = projected_analysis.get("metrics")
        if isinstance(metrics, dict):
            metrics.pop("top_holding_symbol", None)
            for flag in metrics.get("concentration_flags", []):
                if isinstance(flag, dict):
                    flag.pop("symbol", None)
        projected_analysis.pop("profile", None)
        return {"analysis": projected_analysis}

    normalized = payload.get("normalized")
    if not isinstance(normalized, dict):
        return {}
    profile = normalized.get("profile", {})
    return {
        "normalized": {
            "profile": {
                key: deepcopy(profile.get(key))
                for key in (
                    "goal",
                    "time_horizon_years",
                    "risk_tolerance",
                    "liquidity_need",
                )
                if isinstance(profile, dict) and key in profile
            },
            "holding_count": len(normalized.get("holdings", []))
            if isinstance(normalized.get("holdings"), list)
            else 0,
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


def _remove_profile_names(value: Any) -> None:
    if isinstance(value, dict):
        profile = value.get("profile")
        if isinstance(profile, dict):
            profile.pop("name", None)
        for item in value.values():
            _remove_profile_names(item)
    elif isinstance(value, list):
        for item in value:
            _remove_profile_names(item)
