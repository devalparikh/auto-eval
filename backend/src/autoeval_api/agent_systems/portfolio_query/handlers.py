from __future__ import annotations

from collections import Counter
from typing import Any

from autoeval_api.agent_systems.portfolio_query.covered_call import (
    covered_call_candidate,
    normalized_policy,
    positions_by_symbol,
    safety,
)
from autoeval_api.agent_systems.portfolio_query.market_observation import (
    MARKET_DATA_NODE_ID,
    SNAPSHOT_RESOURCE_KEY,
    locked_market_observation,
    market_data_reference,
    refreshed_market_observation,
)
from autoeval_api.agent_systems.portfolio_query.model_context import (
    bounded_question,
    model_candidate,
    model_portfolio_facts,
    model_safety,
    portfolio_facts,
)
from autoeval_api.agent_systems.portfolio_query.types import (
    PortfolioModelContext,
    PortfolioSnapshotReference,
)
from autoeval_api.coerce import integer, number, string_list
from autoeval_api.graph.context import GraphRuntimeContext
from autoeval_api.graph.registry import NodeHandlerRegistry
from autoeval_api.inference.base import InferenceResponse
from autoeval_api.market_data import OPTIONS_CHAIN_SOURCE

MARKET_DATA_RESOURCE_KEY = "portfolio_query.market_data"


def register_handlers(registry: NodeHandlerRegistry) -> None:
    registry.register_contextual_deterministic("get_indexed_portfolio", get_indexed_portfolio)
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


def get_indexed_portfolio(_state: dict[str, Any], context: GraphRuntimeContext) -> dict[str, Any]:
    resource = context.node_resource("get_indexed_portfolio")
    document = resource.content
    context.resources[SNAPSHOT_RESOURCE_KEY] = document
    reference: PortfolioSnapshotReference = {
        "id": resource.snapshot_id,
        "resource_identity": resource.resource_identity,
        "content_hash": str(resource.metadata.get("content_hash", "")),
        "schema_version": int(resource.metadata.get("schema_version", 1)),
        "as_of": str(document.get("as_of", "")),
        "is_synthetic": bool(resource.metadata.get("is_synthetic")),
        "producer_system_key": str(resource.metadata.get("producer_system_key", "")),
        "producer_node_id": str(resource.metadata.get("producer_node_id", "")),
        "resolution_status": "resolved",
    }
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
            "policy": normalized_policy(policy),
        }
    }


async def load_portfolio_market_data(
    state: dict[str, Any], context: GraphRuntimeContext
) -> dict[str, Any]:
    query = state.get("normalized_query", {})
    runtime_input = context.runtime_input(MARKET_DATA_NODE_ID, OPTIONS_CHAIN_SOURCE)
    if query.get("intent") != "covered_call":
        if context.node_snapshots.get(MARKET_DATA_NODE_ID) is None:
            context.bind_node_observation(
                MARKET_DATA_NODE_ID,
                role="produced",
                resolution_mode="live" if runtime_input.mode == "refresh" else "replayed",
                metadata={
                    "output_key": OPTIONS_CHAIN_SOURCE,
                    "schema_version": runtime_input.schema_version,
                    "capture_requested": context.capture_node_outputs,
                    "captured": False,
                    "observation_status": "not_required",
                    "source": OPTIONS_CHAIN_SOURCE,
                },
            )
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
        observation, contracts = locked_market_observation(state, query, context)
    else:
        observation, contracts = await refreshed_market_observation(
            query,
            context,
            runtime_input.capability,
            runtime_input.schema_version,
        )
    if contracts:
        context.resources[MARKET_DATA_RESOURCE_KEY] = contracts
    if runtime_input.mode == "locked" and context.node_snapshots.get(MARKET_DATA_NODE_ID) is None:
        context.bind_node_observation(
            MARKET_DATA_NODE_ID,
            role="consumed",
            resolution_mode="replayed",
            metadata={
                "output_key": OPTIONS_CHAIN_SOURCE,
                "schema_version": runtime_input.schema_version,
                "capture_requested": False,
                "captured": False,
                "observation_status": observation.get("status"),
                "source": observation.get("source"),
                "error_code": observation.get("error_code"),
            },
        )
    return {"market_data_observation": observation}


def validate_portfolio_query(state: dict[str, Any]) -> dict[str, Any]:
    query = state.get("normalized_query", {})
    snapshot = query.get("snapshot", {})
    market = state.get("market_data_observation", {})
    missing = []
    if not query.get("question"):
        missing.append("question")
    if not snapshot.get("id"):
        missing.append("indexed_portfolio")
    if snapshot.get("resolution_status") != "resolved":
        missing.append("snapshot.reference_invalid")

    freshness = market.get("freshness", {}) if isinstance(market, dict) else {}
    quote_age = number(freshness.get("age_seconds"), -3600) / 3600
    market_data_fresh = freshness.get("status") == "fresh"
    if query.get("intent") == "covered_call" and market.get("status") != "ready":
        error_code = str(market.get("error_code", "observation_missing"))
        missing.append(f"market_data.{error_code}")
    if query.get("intent") == "covered_call" and integer(market.get("contract_count")) <= 0:
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
                "market_data": market_data_reference(market_observation),
                "safety": safety(status, []),
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
                    "market_data": market_data_reference(market_observation),
                    "blocked_reasons": ["non_synthetic_fact_selection_required"],
                    "safety": safety(status, []),
                }
            }
        return {
            "query_analysis": {
                "snapshot": reference,
                "intent": "portfolio_question",
                "status": "ready",
                "portfolio_facts": portfolio_facts(
                    snapshot.get("positions", []), include_position_facts=True
                ),
                "candidates": [],
                "market_data": market_data_reference(market_observation),
                "blocked_reasons": [],
                "safety": safety(status, []),
            }
        }
    if not status.get("market_data_fresh"):
        return {
            "query_analysis": {
                "snapshot": reference,
                "intent": "covered_call",
                "status": "needs_market_data",
                "candidates": [],
                "market_data": market_data_reference(market_observation),
                "blocked_reasons": ["stale_option_quotes"],
                "safety": safety(status, []),
            }
        }

    positions = positions_by_symbol(snapshot.get("positions", []))
    policy = query["policy"]
    candidates = []
    failed_checks: Counter[str] = Counter()
    for contract in contracts if isinstance(contracts, list | tuple) else []:
        symbol_positions = positions.get(str(contract.get("symbol", "")).upper())
        candidate, failures = covered_call_candidate(symbol_positions, contract, policy)
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
            "market_data": market_data_reference(market_observation),
            "portfolio_facts": portfolio_facts(
                snapshot.get("positions", []),
                include_position_facts=bool(reference["is_synthetic"]),
            ),
            "blocked_reasons": (
                [] if candidates else [key for key, _ in failed_checks.most_common()]
            ),
            "safety": safety(status, candidates),
        }
    }


def build_portfolio_model_context(state: dict[str, Any]) -> dict[str, Any]:
    analysis = state.get("query_analysis", {})
    query = state.get("normalized_query", {})
    snapshot = analysis.get("snapshot", {})
    is_synthetic = bool(snapshot.get("is_synthetic"))
    model_context: PortfolioModelContext = {
        "schema_version": 1,
        "question": bounded_question(query.get("question")),
        "intent": str(analysis.get("intent", "portfolio_question")),
        "status": str(analysis.get("status", "missing_context")),
        "snapshot": {
            "schema_version": snapshot.get("schema_version"),
            "as_of": snapshot.get("as_of"),
            "is_synthetic": is_synthetic,
        },
        "market_data": market_data_reference(analysis.get("market_data")),
        "portfolio_facts": model_portfolio_facts(
            analysis.get("portfolio_facts"), is_synthetic=is_synthetic
        ),
        "candidates": [
            model_candidate(item, include_symbol=is_synthetic)
            for item in analysis.get("candidates", [])
            if isinstance(item, dict)
        ],
        "blocked_reasons": string_list(analysis.get("blocked_reasons")),
        "safety": model_safety(analysis.get("safety")),
    }
    return {"portfolio_model_context": model_context}


def apply_portfolio_query_safety(state: dict[str, Any]) -> dict[str, Any]:
    analysis = state.get("query_analysis", {})
    explanation = state.get("portfolio_query_explanation", {})
    answer = explanation.get("answer", {}) if isinstance(explanation.get("answer"), dict) else {}
    output = {
        "snapshot": analysis.get("snapshot", {}),
        "market_data": market_data_reference(analysis.get("market_data")),
        "query": {
            "intent": analysis.get("intent"),
            "status": analysis.get("status"),
        },
        "answer": {
            "summary": str(answer.get("summary", "Computed analysis is available below.")),
            "assumptions": string_list(answer.get("assumptions")),
            "risks": string_list(answer.get("risks")),
            "fact_ids": string_list(answer.get("fact_ids")),
            "candidate_ids": string_list(answer.get("candidate_ids")),
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
    fact_ids = string_list(answer.get("fact_ids"))
    candidate_ids = string_list(answer.get("candidate_ids"))
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
                "assumptions": string_list(answer.get("assumptions")),
                "risks": string_list(answer.get("risks")),
                "fact_ids": fact_ids,
                "candidate_ids": candidate_ids,
            }
        }
    }
