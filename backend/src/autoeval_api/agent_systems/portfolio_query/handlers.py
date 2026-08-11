from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
from math import floor
from typing import Any

from autoeval_api.agent_systems.portfolio_query.types import (
    PortfolioModelContext,
    PortfolioSnapshotReference,
)
from autoeval_api.graph.context import GraphRuntimeContext
from autoeval_api.graph.registry import NodeHandlerRegistry
from autoeval_api.inference.base import InferenceResponse
from autoeval_api.market_data import (
    OPTIONS_CHAIN_SOURCE,
    OptionsChainRequest,
    OptionsMarketDataError,
)
from autoeval_api.models import AgentSystemRecord
from autoeval_api.services.portfolio_snapshots import resolve_portfolio_snapshot
from autoeval_api.services.runtime_input_snapshots import (
    create_runtime_input_snapshot,
    runtime_input_snapshot_binding,
)

MODEL_QUESTION_MAX_CHARS = 600
SNAPSHOT_RESOURCE_KEY = "portfolio_query.snapshot"
MARKET_DATA_RESOURCE_KEY = "portfolio_query.market_data"
MARKET_DATA_NODE_ID = "load_portfolio_market_data"


def register_handlers(registry: NodeHandlerRegistry) -> None:
    registry.register_contextual_deterministic(
        "resolve_portfolio_snapshot", resolve_snapshot_reference
    )
    registry.register_deterministic("normalize_portfolio_query", normalize_portfolio_query)
    registry.register_contextual_deterministic(
        "load_portfolio_market_data", load_portfolio_market_data
    )
    registry.register_deterministic("validate_portfolio_query", validate_portfolio_query)
    registry.register_contextual_deterministic(
        "calculate_portfolio_answer", calculate_portfolio_answer
    )
    registry.register_deterministic("build_portfolio_model_context", build_portfolio_model_context)
    registry.register_deterministic("apply_portfolio_query_safety", apply_portfolio_query_safety)
    registry.register_llm_output(
        "merge_portfolio_query_explanation", merge_portfolio_query_explanation
    )


def resolve_snapshot_reference(
    state: dict[str, Any], context: GraphRuntimeContext
) -> dict[str, Any]:
    request = state.get("input", {})
    snapshot_id = str(request.get("snapshot_id", "")).strip()
    reference: PortfolioSnapshotReference = {
        "id": snapshot_id,
        "resolution_status": "missing",
    }
    if not snapshot_id:
        reference["error"] = "snapshot_id"
        return {"portfolio_snapshot_reference": reference}

    try:
        record, document = resolve_portfolio_snapshot(context.session, snapshot_id)
    except ValueError as error:
        reference["resolution_status"] = "invalid"
        reference["error"] = str(error)
        return {"portfolio_snapshot_reference": reference}

    context.resources[SNAPSHOT_RESOURCE_KEY] = document
    context.bind_node_snapshot(
        "resolve_portfolio_snapshot",
        record.id,
        role="consumed",
        resolution_mode="resolved",
        metadata={
            "output_key": "portfolio_state",
            "schema_version": record.schema_version,
            "content_hash": record.content_hash,
            "is_synthetic": record.is_synthetic,
        },
    )
    reference.update(
        {
            "content_hash": record.content_hash,
            "schema_version": record.schema_version,
            "as_of": record.as_of,
            "is_synthetic": record.is_synthetic,
            "resolution_status": "resolved",
        }
    )
    return {"portfolio_snapshot_reference": reference}


def normalize_portfolio_query(state: dict[str, Any]) -> dict[str, Any]:
    request = state.get("input", {})
    question = str(request.get("question", "")).strip()
    snapshot_reference = state.get("portfolio_snapshot_reference", {})
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
            "snapshot": dict(snapshot_reference) if isinstance(snapshot_reference, dict) else {},
            "inline_snapshot_supplied": isinstance(request.get("snapshot"), dict),
            "policy": _normalized_policy(policy),
        }
    }


async def load_portfolio_market_data(
    state: dict[str, Any], context: GraphRuntimeContext
) -> dict[str, Any]:
    query = state.get("normalized_query", {})
    runtime_input = context.runtime_input(MARKET_DATA_NODE_ID, OPTIONS_CHAIN_SOURCE)
    if query.get("intent") != "covered_call":
        return {
            "market_data_observation": {
                "source": OPTIONS_CHAIN_SOURCE,
                "mode": runtime_input.mode,
                "status": "not_required",
                "as_of": None,
                "freshness": {"status": "not_required"},
                "contract_count": 0,
            }
        }

    if runtime_input.mode == "locked":
        observation, contracts = _locked_market_observation(state, query, context)
    else:
        observation, contracts = await _refreshed_market_observation(
            query,
            context,
            runtime_input.capability,
            runtime_input.schema_version,
        )
    if contracts:
        context.resources[MARKET_DATA_RESOURCE_KEY] = contracts
    return {"market_data_observation": observation}


def _locked_market_observation(
    state: dict[str, Any], query: dict[str, Any], context: GraphRuntimeContext
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    binding = context.runtime_input_snapshot(MARKET_DATA_NODE_ID, OPTIONS_CHAIN_SOURCE)
    if binding is not None:
        contracts = _dict_list(binding.payload.get("contracts"))
        if not contracts:
            return _market_data_error("locked", "snapshot_payload_invalid"), []
        provenance = binding.provenance
        freshness = (
            dict(provenance.get("freshness", {}))
            if isinstance(provenance.get("freshness"), dict)
            else {}
        )
        age_seconds = _number(freshness.get("age_seconds"), -1)
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
        _normalize_locked_contract(item, supplied) for item in _dict_list(supplied.get("contracts"))
    ]
    source = str(supplied.get("source", "")).strip()
    as_of = str(supplied.get("as_of", "")).strip()
    quote_age_hours = _optional_number(supplied.get("quote_age_hours"))
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
        "quote_delay_minutes": _integer(supplied.get("quote_delay_minutes")),
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


async def _refreshed_market_observation(
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
                and _integer(position.get("shares")) > _integer(position.get("pledged_shares"))
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
        return _market_data_error("refresh", error.code), []

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
    owner = context.session.query(AgentSystemRecord).filter_by(key=context.agent_system_key).one()
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
    return observation, list(result.contracts)


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
    age_hours = _optional_number(value.get("greeks_age_hours"))
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
    normalized["greeks_age_hours"] = _number(
        observation.get("greeks_age_hours"),
        _number(observation.get("quote_age_hours")),
    )
    return normalized


def validate_portfolio_query(state: dict[str, Any]) -> dict[str, Any]:
    query = state.get("normalized_query", {})
    snapshot = query.get("snapshot", {})
    market = state.get("market_data_observation", {})
    missing = []
    if not query.get("question"):
        missing.append("question")
    if query.get("inline_snapshot_supplied"):
        missing.append("snapshot.inline_not_allowed")
    if not snapshot.get("id"):
        missing.append("snapshot_id")
    if snapshot.get("resolution_status") != "resolved":
        missing.append("snapshot.reference_invalid")

    freshness = market.get("freshness", {}) if isinstance(market, dict) else {}
    quote_age = _number(freshness.get("age_seconds"), -3600) / 3600
    market_data_fresh = freshness.get("status") == "fresh"
    if query.get("intent") == "covered_call" and market.get("status") != "ready":
        error_code = str(market.get("error_code", "observation_missing"))
        missing.append(f"market_data.{error_code}")
    if query.get("intent") == "covered_call" and _integer(market.get("contract_count")) <= 0:
        missing.append("market_data.contracts")
    return {
        "query_status": {
            "ready": not missing,
            "missing_fields": missing,
            "market_data_fresh": market_data_fresh,
            "quote_age_hours": quote_age,
        }
    }


def calculate_portfolio_answer(
    state: dict[str, Any], context: GraphRuntimeContext
) -> dict[str, Any]:
    query = state.get("normalized_query", {})
    status = state.get("query_status", {})
    snapshot_reference = query.get("snapshot", {})
    snapshot = context.resources.get(SNAPSHOT_RESOURCE_KEY, {})
    contracts = context.resources.get(MARKET_DATA_RESOURCE_KEY, [])
    market_observation = state.get("market_data_observation", {})
    reference = {
        "id": snapshot_reference.get("id"),
        "content_hash": snapshot_reference.get("content_hash"),
        "schema_version": snapshot_reference.get("schema_version"),
        "as_of": snapshot_reference.get("as_of"),
        "is_synthetic": bool(snapshot_reference.get("is_synthetic")),
        "resolution_status": snapshot_reference.get("resolution_status"),
    }
    if not status.get("ready") or not isinstance(snapshot, dict) or not snapshot:
        blocked = list(status.get("missing_fields", []))
        if status.get("ready") and not snapshot:
            blocked.append("snapshot.runtime_resource_missing")
        return {
            "query_analysis": {
                "snapshot": reference,
                "intent": query.get("intent"),
                "status": "missing_context",
                "blocked_reasons": blocked,
                "candidates": [],
                "market_data": _market_data_reference(market_observation),
                "safety": _safety(status, []),
            }
        }
    if query.get("intent") != "covered_call":
        if not reference["is_synthetic"]:
            return {
                "query_analysis": {
                    "snapshot": reference,
                    "intent": "portfolio_question",
                    "status": "unsupported",
                    "portfolio_facts": {},
                    "candidates": [],
                    "market_data": _market_data_reference(market_observation),
                    "blocked_reasons": ["non_synthetic_fact_selection_required"],
                    "safety": _safety(status, []),
                }
            }
        return {
            "query_analysis": {
                "snapshot": reference,
                "intent": "portfolio_question",
                "status": "ready",
                "portfolio_facts": _portfolio_facts(
                    snapshot.get("positions", []), include_position_facts=True
                ),
                "candidates": [],
                "market_data": _market_data_reference(market_observation),
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
                "market_data": _market_data_reference(market_observation),
                "blocked_reasons": ["stale_option_quotes"],
                "safety": _safety(status, []),
            }
        }

    positions = _positions_by_symbol(snapshot.get("positions", []))
    policy = query["policy"]
    candidates = []
    failed_checks: Counter[str] = Counter()
    for contract in contracts if isinstance(contracts, list | tuple) else []:
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
            item["provider_contract_id"],
        )
    )
    for rank, candidate in enumerate(candidates, start=1):
        candidate["rank"] = rank
        candidate["candidate_id"] = f"candidate-{rank:03d}"
    return {
        "query_analysis": {
            "snapshot": reference,
            "intent": "covered_call",
            "status": "candidates" if candidates else "blocked",
            "candidates": candidates,
            "market_data": _market_data_reference(market_observation),
            "portfolio_facts": _portfolio_facts(
                snapshot.get("positions", []),
                include_position_facts=bool(reference["is_synthetic"]),
            ),
            "blocked_reasons": (
                [] if candidates else [key for key, _ in failed_checks.most_common()]
            ),
            "safety": _safety(status, candidates),
        }
    }


def build_portfolio_model_context(state: dict[str, Any]) -> dict[str, Any]:
    analysis = state.get("query_analysis", {})
    query = state.get("normalized_query", {})
    snapshot = analysis.get("snapshot", {})
    is_synthetic = bool(snapshot.get("is_synthetic"))
    model_context: PortfolioModelContext = {
        "schema_version": 1,
        "question": _bounded_question(query.get("question")),
        "intent": str(analysis.get("intent", "portfolio_question")),
        "status": str(analysis.get("status", "missing_context")),
        "snapshot": {
            "schema_version": snapshot.get("schema_version"),
            "as_of": snapshot.get("as_of"),
            "is_synthetic": is_synthetic,
        },
        "market_data": _market_data_reference(analysis.get("market_data")),
        "portfolio_facts": _model_portfolio_facts(
            analysis.get("portfolio_facts"), is_synthetic=is_synthetic
        ),
        "candidates": [
            _model_candidate(item, include_symbol=is_synthetic)
            for item in analysis.get("candidates", [])
            if isinstance(item, dict)
        ],
        "blocked_reasons": _string_list(analysis.get("blocked_reasons")),
        "safety": _model_safety(analysis.get("safety")),
    }
    return {"portfolio_model_context": model_context}


def apply_portfolio_query_safety(state: dict[str, Any]) -> dict[str, Any]:
    analysis = state.get("query_analysis", {})
    explanation = state.get("portfolio_query_explanation", {})
    answer = explanation.get("answer", {}) if isinstance(explanation.get("answer"), dict) else {}
    output = {
        "snapshot": analysis.get("snapshot", {}),
        "market_data": _market_data_reference(analysis.get("market_data")),
        "query": {
            "intent": analysis.get("intent"),
            "status": analysis.get("status"),
        },
        "answer": {
            "summary": str(answer.get("summary", "Computed analysis is available below.")),
            "assumptions": _string_list(answer.get("assumptions")),
            "risks": _string_list(answer.get("risks")),
            "fact_ids": _string_list(answer.get("fact_ids")),
            "candidate_ids": _string_list(answer.get("candidate_ids")),
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
    state: dict[str, Any], response: InferenceResponse
) -> dict[str, Any]:
    model_context = state.get("portfolio_model_context", {})
    answer = response.output.get("answer", {})
    if not isinstance(model_context, dict) or not isinstance(answer, dict):
        raise ValueError("Portfolio query explanation must contain a structured answer")

    facts = model_context.get("portfolio_facts", {})
    position_facts = facts.get("position_facts", []) if isinstance(facts, dict) else []
    allowed_fact_ids = {
        str(item.get("fact_id"))
        for item in position_facts
        if isinstance(item, dict) and item.get("fact_id")
    }
    allowed_candidate_ids = {
        str(item.get("candidate_id"))
        for item in model_context.get("candidates", [])
        if isinstance(item, dict) and item.get("candidate_id")
    }
    fact_ids = _string_list(answer.get("fact_ids"))
    candidate_ids = _string_list(answer.get("candidate_ids"))
    unknown_facts = sorted(set(fact_ids) - allowed_fact_ids)
    unknown_candidates = sorted(set(candidate_ids) - allowed_candidate_ids)
    if unknown_facts or unknown_candidates:
        raise ValueError(
            "Portfolio query explanation referenced unknown facts or candidates: "
            f"facts={unknown_facts}, candidates={unknown_candidates}"
        )

    return {
        "portfolio_query_explanation": {
            "answer": {
                "summary": str(answer.get("summary", "")),
                "assumptions": _string_list(answer.get("assumptions")),
                "risks": _string_list(answer.get("risks")),
                "fact_ids": fact_ids,
                "candidate_ids": candidate_ids,
            }
        }
    }


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
    delta_value = _optional_number(contract.get("delta"))
    delta = abs(delta_value) if delta_value is not None else 0
    open_interest = _optional_integer(contract.get("open_interest"))
    event_data_known = contract.get("event_data_known") is True
    greeks_age_hours = _optional_number(contract.get("greeks_age_hours"))
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


def _portfolio_facts(
    positions: list[dict[str, Any]], *, include_position_facts: bool = False
) -> dict[str, Any]:
    ordered = sorted(positions, key=lambda item: _number(item.get("weight")), reverse=True)
    facts = {
        "position_count": len(positions),
        "largest_symbol": str(ordered[0].get("symbol")) if ordered else None,
        "largest_weight": _round(_number(ordered[0].get("weight"))) if ordered else 0,
        "bucket_weights": _bucket_weights(positions),
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
        "shares": max(0, _integer(value.get("shares"))),
        "pledged_shares": max(0, _integer(value.get("pledged_shares"))),
        "weight": _round(_number(value.get("weight"))),
        "bucket": str(value.get("bucket", "unassigned")),
        "tags": [str(item) for item in value.get("tags", []) if isinstance(item, str)],
        "covered_calls_allowed": bool(value.get("covered_calls_allowed")),
        "assignment_acceptable": bool(value.get("assignment_acceptable")),
        "do_not_touch": bool(value.get("do_not_touch")),
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
        "max_greeks_age_hours": _number(value.get("max_greeks_age_hours"), 4),
        "earnings_blackout": bool(value.get("earnings_blackout", True)),
        "max_contracts_per_symbol": max(1, _integer(value.get("max_contracts_per_symbol"), 1)),
    }


def _model_candidate(value: dict[str, Any], *, include_symbol: bool) -> dict[str, Any]:
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


def _market_data_reference(value: Any) -> dict[str, Any]:
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
            "provider_ref",
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


def _model_portfolio_facts(value: Any, *, is_synthetic: bool) -> dict[str, Any]:
    if not is_synthetic or not isinstance(value, dict):
        return {}
    bucket_weights = value.get("bucket_weights", {})
    position_facts = value.get("position_facts", [])
    return {
        "position_count": _integer(value.get("position_count")),
        "largest_symbol": str(value.get("largest_symbol", "")),
        "largest_weight": _number(value.get("largest_weight")),
        "bucket_weights": {str(key): _number(weight) for key, weight in bucket_weights.items()}
        if isinstance(bucket_weights, dict)
        else {},
        "position_facts": [
            {
                "fact_id": str(item.get("fact_id", "")),
                "symbol": str(item.get("symbol", "")),
                "instrument_type": str(item.get("instrument_type", "unknown")),
                "shares": max(0, _integer(item.get("shares"))),
                "pledged_shares": max(0, _integer(item.get("pledged_shares"))),
                "weight": _number(item.get("weight")),
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


def _model_safety(value: Any) -> dict[str, bool]:
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


def _bounded_question(value: Any) -> str:
    normalized = " ".join(str(value or "").split())
    return normalized[:MODEL_QUESTION_MAX_CHARS]


def _dict_list(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _string_list(value: Any) -> list[str]:
    return [str(item) for item in value] if isinstance(value, list) else []


def _number(value: Any, default: float = 0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _optional_number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def _integer(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _optional_integer(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _round(value: float) -> float:
    return round(value, 6)
