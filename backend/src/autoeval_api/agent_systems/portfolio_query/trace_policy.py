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
    "provider_contract_id",
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
    projected = _redact(payload)
    if _is_final_output(payload):
        _restore_final_candidate_symbols(payload, projected)
    if _has_resolved_synthetic_reference(payload):
        _restore_synthetic_details(payload, projected)
    nested_output = payload.get("output")
    if isinstance(nested_output, dict):
        projected["output"] = project_payload(nested_output)
    return projected


def project_inference_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Send only the explicit, provider-safe model context assembled by the graph."""
    model_context = payload.get("portfolio_model_context")
    if not isinstance(model_context, dict):
        return {"input": {"is_synthetic": False}, "portfolio_model_context": {}}
    snapshot = model_context.get("snapshot", {})
    snapshot = snapshot if isinstance(snapshot, dict) else {}
    is_synthetic = bool(snapshot.get("is_synthetic"))
    return {
        "input": {"is_synthetic": is_synthetic},
        "portfolio_model_context": {
            "schema_version": model_context.get("schema_version"),
            "question": " ".join(str(model_context.get("question", "")).split())[:600],
            "intent": model_context.get("intent"),
            "status": model_context.get("status"),
            "snapshot": {
                "schema_version": snapshot.get("schema_version"),
                "as_of": snapshot.get("as_of"),
                "is_synthetic": is_synthetic,
            },
            "market_data": _market_data(model_context.get("market_data")),
            "blocked_reasons": _string_list(model_context.get("blocked_reasons")),
            "portfolio_facts": _portfolio_facts(
                model_context.get("portfolio_facts"), is_synthetic=is_synthetic
            ),
            "candidates": [
                _candidate(item, include_symbol=is_synthetic)
                for item in model_context.get("candidates", [])
                if isinstance(item, dict)
            ],
            "safety": _safety(model_context.get("safety")),
        },
    }


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _redact(item) for key, item in value.items() if key.lower() not in SENSITIVE_KEYS
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return deepcopy(value)


def _candidate(value: dict[str, Any], *, include_symbol: bool) -> dict[str, Any]:
    metrics = value.get("metrics", {}) if isinstance(value.get("metrics"), dict) else {}
    projected = {
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
        "policy_checks": _redact(value.get("policy_checks", [])),
    }
    if include_symbol:
        projected["symbol"] = str(value.get("symbol", ""))
    return projected


def _portfolio_facts(value: Any, *, is_synthetic: bool) -> dict[str, Any]:
    if not is_synthetic or not isinstance(value, dict):
        return {}
    bucket_weights = value.get("bucket_weights", {})
    position_facts = value.get("position_facts", [])
    return {
        "position_count": value.get("position_count"),
        "largest_symbol": value.get("largest_symbol"),
        "largest_weight": value.get("largest_weight"),
        "bucket_weights": {str(key): weight for key, weight in bucket_weights.items()}
        if isinstance(bucket_weights, dict)
        else {},
        "position_facts": [
            {
                key: deepcopy(item.get(key))
                for key in (
                    "fact_id",
                    "symbol",
                    "instrument_type",
                    "shares",
                    "pledged_shares",
                    "weight",
                    "bucket",
                    "tags",
                    "covered_calls_allowed",
                    "assignment_acceptable",
                    "do_not_touch",
                )
            }
            for item in position_facts
            if isinstance(item, dict) and item.get("fact_id")
        ],
    }


def _safety(value: Any) -> dict[str, bool]:
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


def _market_data(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    freshness = value.get("freshness", {})
    greeks = value.get("greeks", {})
    runtime_snapshot = value.get("runtime_input_snapshot", {})
    return {
        key: deepcopy(value.get(key))
        for key in (
            "source",
            "mode",
            "status",
            "provider",
            "provider_ref",
            "as_of",
            "fetched_at",
            "error_code",
            "contract_count",
        )
        if value.get(key) is not None
    } | {
        "freshness": {
            key: deepcopy(freshness.get(key))
            for key in (
                "status",
                "age_seconds",
                "max_age_seconds",
                "quote_delay_minutes",
            )
            if isinstance(freshness, dict) and freshness.get(key) is not None
        },
        "greeks": {
            key: deepcopy(greeks.get(key))
            for key in ("status", "as_of", "age_seconds")
            if isinstance(greeks, dict) and greeks.get(key) is not None
        },
        "runtime_input_snapshot": {
            key: deepcopy(runtime_snapshot.get(key))
            for key in (
                "id",
                "source_key",
                "schema_version",
                "content_hash",
                "is_synthetic",
            )
            if isinstance(runtime_snapshot, dict) and runtime_snapshot.get(key) is not None
        },
    }


def _string_list(value: Any) -> list[str]:
    return [str(item) for item in value] if isinstance(value, list) else []


def _is_final_output(payload: dict[str, Any]) -> bool:
    return isinstance(payload.get("query"), dict) and isinstance(payload.get("covered_call"), dict)


def _restore_final_candidate_symbols(source: dict[str, Any], projected: dict[str, Any]) -> None:
    source_covered = source.get("covered_call", {})
    projected_covered = projected.get("covered_call", {})
    if not isinstance(source_covered, dict) or not isinstance(projected_covered, dict):
        return
    source_candidates = source_covered.get("candidates", [])
    projected_candidates = projected_covered.get("candidates", [])
    if not isinstance(source_candidates, list) or not isinstance(projected_candidates, list):
        return
    for original, candidate in zip(source_candidates, projected_candidates, strict=False):
        if isinstance(original, dict) and isinstance(candidate, dict) and original.get("symbol"):
            candidate["symbol"] = str(original["symbol"])


def _restore_synthetic_details(source: dict[str, Any], projected: dict[str, Any]) -> None:
    source_analysis = source.get("query_analysis")
    projected_analysis = projected.get("query_analysis")
    if isinstance(source_analysis, dict) and isinstance(projected_analysis, dict):
        projected_analysis["portfolio_facts"] = _portfolio_facts(
            source_analysis.get("portfolio_facts"), is_synthetic=True
        )
        projected_analysis["candidates"] = [
            _synthetic_trace_candidate(item)
            for item in source_analysis.get("candidates", [])
            if isinstance(item, dict)
        ]

    if isinstance(source.get("portfolio_facts"), dict):
        projected["portfolio_facts"] = _portfolio_facts(
            source.get("portfolio_facts"), is_synthetic=True
        )
    source_covered = source.get("covered_call")
    projected_covered = projected.get("covered_call")
    if isinstance(source_covered, dict) and isinstance(projected_covered, dict):
        projected_covered["candidates"] = [
            _synthetic_trace_candidate(item)
            for item in source_covered.get("candidates", [])
            if isinstance(item, dict)
        ]


def _synthetic_trace_candidate(value: dict[str, Any]) -> dict[str, Any]:
    projected = _candidate(value, include_symbol=True)
    projected["contracts"] = value.get("contracts")
    metrics = value.get("metrics", {})
    if isinstance(metrics, dict):
        projected["metrics"]["gross_premium_usd"] = metrics.get("gross_premium_usd")
    projected["assignment_impact"] = deepcopy(value.get("assignment_impact", {}))
    return projected


def _has_resolved_synthetic_reference(payload: dict[str, Any]) -> bool:
    reference = payload.get("portfolio_snapshot_reference")
    if isinstance(reference, dict):
        return (
            reference.get("resolution_status") == "resolved"
            and reference.get("is_synthetic") is True
        )

    analysis = payload.get("query_analysis")
    if isinstance(analysis, dict):
        snapshot = analysis.get("snapshot")
        return isinstance(snapshot, dict) and (
            snapshot.get("resolution_status") == "resolved" and snapshot.get("is_synthetic") is True
        )

    if isinstance(payload.get("query"), dict):
        snapshot = payload.get("snapshot")
        return isinstance(snapshot, dict) and (
            snapshot.get("resolution_status") == "resolved" and snapshot.get("is_synthetic") is True
        )
    return False
