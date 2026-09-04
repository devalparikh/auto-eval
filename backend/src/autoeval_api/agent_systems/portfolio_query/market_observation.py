from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from autoeval_api.coerce import dict_list, integer, number, optional_number
from autoeval_api.graph.context import GraphRuntimeContext
from autoeval_api.market_data import (
    OPTIONS_CHAIN_SOURCE,
    OptionsChainRequest,
    OptionsMarketDataError,
)
from autoeval_api.models import AgentSystemRecord
from autoeval_api.services.runtime_input_snapshots import (
    create_runtime_input_snapshot,
    runtime_input_snapshot_binding,
)

SNAPSHOT_RESOURCE_KEY = "portfolio_query.snapshot"
MARKET_DATA_NODE_ID = "load_portfolio_market_data"


def locked_market_observation(
    state: dict[str, Any], query: dict[str, Any], context: GraphRuntimeContext
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    binding = context.runtime_input_snapshot(MARKET_DATA_NODE_ID, OPTIONS_CHAIN_SOURCE)
    if binding is not None:
        contracts = dict_list(binding.payload.get("contracts"))
        if not contracts:
            return _market_data_error("locked", "snapshot_payload_invalid"), []
        provenance = binding.provenance
        freshness = (
            dict(provenance.get("freshness", {}))
            if isinstance(provenance.get("freshness"), dict)
            else {}
        )
        age_seconds = number(freshness.get("age_seconds"), -1)
        max_age_seconds = query["policy"]["max_quote_age_hours"] * 3600
        freshness.update(
            {
                "status": ("fresh" if 0 <= age_seconds <= max_age_seconds else "stale"),
                "max_age_seconds": round(max_age_seconds, 3),
            }
        )
        return (
            {
                "source": str(provenance.get("source", OPTIONS_CHAIN_SOURCE)),
                "mode": "locked",
                "status": "ready",
                "provider": str(provenance.get("provider", "recorded-snapshot")),
                "provider_ref": provenance.get("provider_ref"),
                "as_of": provenance.get("as_of"),
                "fetched_at": provenance.get("fetched_at"),
                "freshness": freshness,
                "greeks": dict(provenance.get("greeks", {}))
                if isinstance(provenance.get("greeks"), dict)
                else {},
                "contract_count": len(contracts),
                "runtime_input_snapshot": {
                    "id": binding.id,
                    "source_key": binding.source_key,
                    "schema_version": binding.schema_version,
                    "content_hash": binding.content_hash,
                    "is_synthetic": binding.is_synthetic,
                },
            },
            contracts,
        )

    # Compatibility only for finalized dataset versions created before runtime snapshots.
    supplied = state.get("input", {}).get("market_context")
    if not isinstance(supplied, dict):
        return _market_data_error("locked", "locked_observation_missing"), []
    contracts = [
        _normalize_locked_contract(item, supplied) for item in dict_list(supplied.get("contracts"))
    ]
    source = str(supplied.get("source", "")).strip()
    as_of = str(supplied.get("as_of", "")).strip()
    quote_age_hours = optional_number(supplied.get("quote_age_hours"))
    if not source or not as_of or quote_age_hours is None or quote_age_hours < 0:
        return _market_data_error("locked", "locked_observation_invalid"), []
    if not contracts:
        return _market_data_error("locked", "locked_observation_empty"), []

    age_seconds = quote_age_hours * 3600
    max_age_seconds = query["policy"]["max_quote_age_hours"] * 3600
    freshness = {
        "status": "fresh" if age_seconds <= max_age_seconds else "stale",
        "age_seconds": round(age_seconds, 3),
        "max_age_seconds": round(max_age_seconds, 3),
        "quote_delay_minutes": integer(supplied.get("quote_delay_minutes")),
    }
    return (
        {
            "source": source,
            "mode": "locked",
            "status": "ready",
            "provider": "recorded-fixture",
            "provider_ref": str(supplied.get("provider_ref", "")) or None,
            "as_of": as_of,
            "fetched_at": str(supplied.get("fetched_at", as_of)),
            "freshness": freshness,
            "greeks": _locked_greeks_provenance(supplied),
            "contract_count": len(contracts),
        },
        contracts,
    )


async def refreshed_market_observation(
    query: dict[str, Any],
    context: GraphRuntimeContext,
    capability: Any,
    schema_version: int,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    snapshot = context.resources.get(SNAPSHOT_RESOURCE_KEY, {})
    reference = query.get("snapshot", {})
    positions = snapshot.get("positions", []) if isinstance(snapshot, dict) else []
    symbols = tuple(
        sorted(
            {
                str(position.get("symbol", "")).strip().upper()
                for position in positions
                if isinstance(position, dict)
                and position.get("covered_calls_allowed") is True
                and integer(position.get("shares")) > integer(position.get("pledged_shares"))
            }
        )
    )
    requested_at = datetime.now(UTC)
    try:
        result = await capability.refresh(
            OptionsChainRequest(
                symbols=symbols,
                min_dte=query["policy"]["min_dte"],
                max_dte=query["policy"]["max_dte"],
                is_synthetic=bool(reference.get("is_synthetic")),
                requested_at=requested_at,
            )
        )
    except OptionsMarketDataError as error:
        observation = _market_data_error("refresh", error.code)
        _bind_market_execution_observation(
            context,
            observation,
            schema_version=schema_version,
            captured=False,
        )
        return observation, []

    age_seconds = max(0.0, (result.fetched_at - result.as_of).total_seconds())
    max_age_seconds = query["policy"]["max_quote_age_hours"] * 3600
    freshness = {
        "status": "fresh" if age_seconds <= max_age_seconds else "stale",
        "age_seconds": round(age_seconds, 3),
        "max_age_seconds": round(max_age_seconds, 3),
        "quote_delay_minutes": result.quote_delay_minutes,
    }
    greeks_age = (
        max(0.0, (result.fetched_at - result.greeks_as_of).total_seconds())
        if result.greeks_as_of is not None
        else None
    )
    observation = {
        "source": result.source,
        "mode": "refresh",
        "status": "ready",
        "provider": result.provider_id,
        "provider_ref": result.provider_ref,
        "as_of": result.as_of.isoformat().replace("+00:00", "Z"),
        "fetched_at": result.fetched_at.isoformat().replace("+00:00", "Z"),
        "freshness": freshness,
        "greeks": {
            "status": "available" if result.greeks_as_of is not None else "unavailable",
            "as_of": (
                result.greeks_as_of.isoformat().replace("+00:00", "Z")
                if result.greeks_as_of is not None
                else None
            ),
            "age_seconds": round(greeks_age, 3) if greeks_age is not None else None,
        },
        "contract_count": len(result.contracts),
    }
    if context.capture_node_outputs:
        owner = (
            context.session.query(AgentSystemRecord).filter_by(key=context.agent_system_key).one()
        )
        record = create_runtime_input_snapshot(
            context.session,
            owner,
            source_trace_id=context.trace_id,
            node_id=MARKET_DATA_NODE_ID,
            source_key=OPTIONS_CHAIN_SOURCE,
            schema_version=schema_version,
            label=f"{result.source} options observation",
            observed_at=result.as_of,
            fetched_at=result.fetched_at,
            provider=result.provider_id,
            source_kind="synthetic" if bool(reference.get("is_synthetic")) else "live_refresh",
            is_synthetic=bool(reference.get("is_synthetic")),
            payload={"schema_version": schema_version, "contracts": list(result.contracts)},
            provenance=observation,
        )
        binding = runtime_input_snapshot_binding(record)
        context.bind_runtime_input_snapshot(MARKET_DATA_NODE_ID, binding)
        observation["runtime_input_snapshot"] = {
            "id": binding.id,
            "source_key": binding.source_key,
            "schema_version": binding.schema_version,
            "content_hash": binding.content_hash,
            "is_synthetic": binding.is_synthetic,
        }
        _bind_market_execution_observation(
            context,
            observation,
            schema_version=schema_version,
            captured=True,
            snapshot_id=binding.id,
        )
    else:
        _bind_market_execution_observation(
            context,
            observation,
            schema_version=schema_version,
            captured=False,
        )
    return observation, list(result.contracts)


def _bind_market_execution_observation(
    context: GraphRuntimeContext,
    observation: dict[str, Any],
    *,
    schema_version: int,
    captured: bool,
    snapshot_id: str | None = None,
) -> None:
    metadata = {
        "output_key": OPTIONS_CHAIN_SOURCE,
        "schema_version": schema_version,
        "capture_requested": context.capture_node_outputs,
        "captured": captured,
        "observation_status": observation.get("status"),
        "source": observation.get("source"),
        "provider": observation.get("provider"),
        "as_of": observation.get("as_of"),
        "fetched_at": observation.get("fetched_at"),
        "freshness": observation.get("freshness"),
        "error_code": observation.get("error_code"),
    }
    if snapshot_id is not None:
        context.bind_node_snapshot(
            MARKET_DATA_NODE_ID,
            snapshot_id,
            role="produced",
            resolution_mode="live",
            metadata=metadata,
        )
    else:
        context.bind_node_observation(
            MARKET_DATA_NODE_ID,
            role="produced",
            resolution_mode="live",
            metadata=metadata,
        )


def _market_data_error(mode: str, code: str) -> dict[str, Any]:
    return {
        "source": OPTIONS_CHAIN_SOURCE,
        "mode": mode,
        "status": "error",
        "error_code": code,
        "as_of": None,
        "freshness": {"status": "unknown"},
        "greeks": {"status": "unknown", "as_of": None, "age_seconds": None},
        "contract_count": 0,
    }


def _locked_greeks_provenance(value: dict[str, Any]) -> dict[str, Any]:
    as_of = str(value.get("greeks_as_of", "")).strip() or None
    age_hours = optional_number(value.get("greeks_age_hours"))
    return {
        "status": "available" if as_of else "unknown",
        "as_of": as_of,
        "age_seconds": round(age_hours * 3600, 3) if age_hours is not None else None,
    }


def _normalize_locked_contract(
    value: dict[str, Any], observation: dict[str, Any]
) -> dict[str, Any]:
    normalized = dict(value)
    normalized["provider_contract_id"] = str(
        value.get("provider_contract_id") or value.get("contract_id") or ""
    )
    normalized["event_data_known"] = value.get("event_data_known") is True
    normalized["quote_timestamp_available"] = True
    normalized["underlying_timestamp_available"] = True
    normalized["greeks_age_hours"] = number(
        observation.get("greeks_age_hours"),
        number(observation.get("quote_age_hours")),
    )
    return normalized


def market_data_reference(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    freshness = value.get("freshness", {})
    greeks = value.get("greeks", {})
    runtime_snapshot = value.get("runtime_input_snapshot", {})
    return {
        key: value.get(key)
        for key in (
            "source",
            "mode",
            "status",
            "provider",
            "as_of",
            "fetched_at",
            "error_code",
            "contract_count",
        )
        if value.get(key) is not None
    } | {
        "freshness": {
            key: freshness.get(key)
            for key in (
                "status",
                "age_seconds",
                "max_age_seconds",
                "quote_delay_minutes",
            )
            if isinstance(freshness, dict) and freshness.get(key) is not None
        },
        "greeks": {
            key: greeks.get(key)
            for key in ("status", "as_of", "age_seconds")
            if isinstance(greeks, dict) and greeks.get(key) is not None
        },
        "runtime_input_snapshot": {
            key: runtime_snapshot.get(key)
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
