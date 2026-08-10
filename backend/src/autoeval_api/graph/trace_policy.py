from copy import deepcopy
from typing import Any

SENSITIVE_KEYS = {
    "account_id",
    "account_name",
    "cost_basis",
    "email",
    "market_value",
    "name",
    "owner",
    "value",
}


def project_trace_payload(system_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    if system_key != "portfolio-analyst":
        return deepcopy(payload)
    return _redact(payload)


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _redact(item) for key, item in value.items() if key.lower() not in SENSITIVE_KEYS
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return deepcopy(value)
