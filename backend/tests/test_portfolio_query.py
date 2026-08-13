import asyncio
from copy import deepcopy
from datetime import datetime

import pytest

from autoeval_api.agent_systems.portfolio_analyst.snapshots import (
    SYNTHETIC_SNAPSHOT_DOCUMENT,
)
from autoeval_api.agent_systems.portfolio_query.definition import (
    PORTFOLIO_QUERY_GRAPH,
    PORTFOLIO_QUERY_INPUT_TEMPLATE,
)
from autoeval_api.agent_systems.portfolio_query.handlers import (
    apply_portfolio_query_safety,
    build_portfolio_model_context,
    calculate_portfolio_answer,
    get_indexed_portfolio,
    load_portfolio_market_data,
    merge_portfolio_query_explanation,
    normalize_portfolio_query,
    validate_portfolio_query,
)
from autoeval_api.agent_systems.portfolio_query.runtime_fixtures import (
    ELIGIBLE_OPTIONS_PAYLOAD,
    ELIGIBLE_OPTIONS_PROVENANCE,
)
from autoeval_api.agent_systems.portfolio_query.seed import ensure_seed_data
from autoeval_api.agent_systems.portfolio_query.trace_policy import (
    project_inference_payload,
    project_payload,
)
from autoeval_api.graph.context import GraphRuntimeContext, NodeResourceExecutionBinding
from autoeval_api.graph.runtime_inputs import RuntimeInputCapabilityRegistry
from autoeval_api.inference.base import InferenceResponse
from autoeval_api.models import AgentSystemRecord, DatasetItemRecord
from autoeval_api.services.node_resources import resolve_node_resource
from autoeval_api.services.portfolio_snapshots import create_portfolio_snapshot
from autoeval_api.services.runtime_input_snapshots import (
    create_runtime_input_snapshot,
    resolve_runtime_input_snapshot,
    runtime_input_snapshot_binding,
)


class NeverRefreshCapability:
    async def refresh(self, _request):
        raise AssertionError("locked runtime inputs must never call a provider")


def analysis_for(
    session,
    request_input: dict,
    *,
    market_payload: dict | None = None,
    runtime_snapshot_id: str | None = None,
    portfolio_snapshot_id: str | None = None,
    bind_runtime_snapshot: bool = True,
) -> dict:
    _graph, _prompt, dataset = ensure_seed_data(session)
    runtime_inputs = RuntimeInputCapabilityRegistry()
    runtime_inputs.register("options_chain", NeverRefreshCapability())
    context = GraphRuntimeContext(
        session,
        "portfolio-query",
        runtime_inputs=runtime_inputs,
        runtime_input_modes={"load_portfolio_market_data": ("options_chain", "locked", 1)},
    )
    if portfolio_snapshot_id is None:
        item = next(
            item
            for item in session.query(DatasetItemRecord)
            .filter_by(dataset_version_id=dataset.id)
            .all()
            if item.expected.get("status") == "candidates"
        )
        portfolio_snapshot_id = item.node_resource_selections["get_indexed_portfolio"][
            "snapshot_id"
        ]
    resource_policy = next(
        node["resource_policy"]
        for node in PORTFOLIO_QUERY_GRAPH["nodes"]
        if node["id"] == "get_indexed_portfolio"
    )
    resolved_resource = resolve_node_resource(
        session,
        consumer_system_key="portfolio-query",
        policy_value=resource_policy,
        selection_value={"mode": "locked", "snapshot_id": portfolio_snapshot_id},
    )
    context.bind_node_resource(
        "get_indexed_portfolio",
        NodeResourceExecutionBinding(
            snapshot_id=resolved_resource.snapshot_id,
            resource_identity=resolved_resource.resource_identity,
            content=resolved_resource.content,
            metadata=resolved_resource.metadata,
        ),
        selection_mode="locked",
    )
    if bind_runtime_snapshot:
        if market_payload is not None:
            owner = session.query(AgentSystemRecord).filter_by(key="portfolio-query").one()
            provenance = deepcopy(ELIGIBLE_OPTIONS_PROVENANCE)
            record = create_runtime_input_snapshot(
                session,
                owner,
                source_trace_id=None,
                node_id="load_portfolio_market_data",
                source_key="options_chain",
                schema_version=1,
                label="Portfolio Query test observation",
                observed_at=datetime.fromisoformat(str(provenance["as_of"]).replace("Z", "+00:00")),
                fetched_at=datetime.fromisoformat(
                    str(provenance["fetched_at"]).replace("Z", "+00:00")
                ),
                provider=str(provenance["provider"]),
                source_kind="test_fixture",
                is_synthetic=True,
                payload=deepcopy(market_payload),
                provenance=provenance,
            )
        else:
            if runtime_snapshot_id is None:
                item = next(
                    item
                    for item in session.query(DatasetItemRecord)
                    .filter_by(dataset_version_id=dataset.id)
                    .all()
                    if item.expected.get("status") == "candidates"
                )
                runtime_snapshot_id = item.runtime_input_snapshot_ids["load_portfolio_market_data"]
            record, _payload = resolve_runtime_input_snapshot(
                session,
                runtime_snapshot_id,
                owner_system_key="portfolio-query",
                source_key="options_chain",
                node_id="load_portfolio_market_data",
                schema_version=1,
            )
        context.bind_runtime_input_snapshot(
            "load_portfolio_market_data",
            runtime_input_snapshot_binding(record),
        )
    state = {"input": request_input}
    state.update(get_indexed_portfolio(state, context))
    state.update(normalize_portfolio_query(state))
    state.update(asyncio.run(load_portfolio_market_data(state, context)))
    state.update(validate_portfolio_query(state))
    state.update(calculate_portfolio_answer(state, context))
    state.update(build_portfolio_model_context(state))
    return state


def test_covered_call_rejects_put_contracts(session_factory) -> None:
    session = session_factory()
    try:
        request_input = deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE)
        payload = deepcopy(ELIGIBLE_OPTIONS_PAYLOAD)
        payload["contracts"] = payload["contracts"][:1]
        payload["contracts"][0]["option_type"] = "put"

        analysis = analysis_for(session, request_input, market_payload=payload)["query_analysis"]

        assert analysis["status"] == "blocked"
        assert analysis["candidates"] == []
        assert "call_option" in analysis["blocked_reasons"]
        assert analysis["safety"]["fully_covered"] is False
    finally:
        session.close()


def test_locked_market_data_requires_a_recorded_observation(session_factory) -> None:
    session = session_factory()
    try:
        request_input = deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE)

        state = analysis_for(session, request_input, bind_runtime_snapshot=False)

        assert state["market_data_observation"]["mode"] == "locked"
        assert state["market_data_observation"]["error_code"] == "locked_observation_missing"
        assert "market_data.locked_observation_missing" in state["query_status"]["missing_fields"]
        assert state["query_analysis"]["status"] == "missing_context"
    finally:
        session.close()


def test_unknown_earnings_status_fails_closed_when_blackout_is_enabled(
    session_factory,
) -> None:
    session = session_factory()
    try:
        request_input = deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE)
        payload = deepcopy(ELIGIBLE_OPTIONS_PAYLOAD)
        for contract in payload["contracts"]:
            contract["event_data_known"] = False
            contract["earnings_before_expiry"] = None

        analysis = analysis_for(session, request_input, market_payload=payload)["query_analysis"]

        assert analysis["status"] == "blocked"
        assert "event_data_known" in analysis["blocked_reasons"]
        assert "event_policy_met" in analysis["blocked_reasons"]
    finally:
        session.close()


def test_duplicate_symbol_lots_preserve_eligible_sleeve(session_factory) -> None:
    session = session_factory()
    try:
        ensure_seed_data(session)
        owner = session.query(AgentSystemRecord).filter_by(key="portfolio-analyst").one()
        document = deepcopy(SYNTHETIC_SNAPSHOT_DOCUMENT)
        document["positions"].append(
            {
                "position_id": "synthetic-core-nvda",
                "symbol": "NVDA",
                "instrument_type": "equity",
                "shares": 500,
                "pledged_shares": 0,
                "weight": 0.2,
                "bucket": "core",
                "covered_calls_allowed": False,
                "assignment_acceptable": False,
                "do_not_touch": True,
            }
        )
        snapshot = create_portfolio_snapshot(
            session,
            owner,
            snapshot_id="synthetic-duplicate-symbol-lots",
            label="Synthetic duplicate-symbol lots",
            as_of=document["as_of"],
            source_kind="synthetic",
            is_synthetic=True,
            document=document,
        )
        analysis = analysis_for(
            session,
            deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE),
            portfolio_snapshot_id=snapshot.id,
        )["query_analysis"]

        assert analysis["status"] == "candidates"
        assert analysis["candidates"][0]["candidate_id"] == "candidate-001"
        assert analysis["candidates"][0]["provider_contract_id"] == "NVDA_SYNTH_CALL_160"
        assert analysis["candidates"][0]["assignment_impact"]["buckets"] == ["tactical"]
    finally:
        session.close()


def test_request_snapshot_fields_cannot_override_selected_resource(session_factory) -> None:
    session = session_factory()
    try:
        request_input = deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE)
        request_input["snapshot"] = deepcopy(SYNTHETIC_SNAPSHOT_DOCUMENT)
        request_input["snapshot_id"] = "attacker-selected-snapshot"

        state = analysis_for(session, request_input)

        assert state["portfolio_snapshot_reference"]["resolution_status"] == "resolved"
        assert state["portfolio_snapshot_reference"]["id"] != "attacker-selected-snapshot"
        assert state["query_status"]["ready"] is True
    finally:
        session.close()


def test_seeded_dataset_items_resolve_immutable_snapshot_ids(session_factory) -> None:
    session = session_factory()
    try:
        _graph, _prompt, dataset = ensure_seed_data(session)
        items = session.query(DatasetItemRecord).filter_by(dataset_version_id=dataset.id).all()
        for item in items:
            snapshot_id = item.runtime_input_snapshot_ids["load_portfolio_market_data"]
            portfolio_snapshot_id = item.node_resource_selections["get_indexed_portfolio"][
                "snapshot_id"
            ]
            state = analysis_for(
                session,
                deepcopy(item.input),
                runtime_snapshot_id=snapshot_id,
                portfolio_snapshot_id=portfolio_snapshot_id,
            )
            assert state["portfolio_snapshot_reference"]["resolution_status"] == "resolved"
            assert "snapshot" not in item.input
            assert "snapshot_id" not in item.input
            assert "market_context" not in item.input
            assert state["market_data_observation"]["runtime_input_snapshot"]["id"] == snapshot_id
    finally:
        session.close()


def test_generic_question_does_not_require_an_options_observation(session_factory) -> None:
    session = session_factory()
    try:
        request_input = deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE)
        request_input["question"] = "How many positions are in this portfolio?"

        state = analysis_for(session, request_input, bind_runtime_snapshot=False)

        assert state["normalized_query"]["intent"] == "portfolio_question"
        assert state["market_data_observation"]["status"] == "not_required"
        assert state["query_status"]["ready"] is True
    finally:
        session.close()


def test_provider_projection_is_explicit_and_supports_synthetic_qa(session_factory) -> None:
    session = session_factory()
    try:
        state = analysis_for(session, deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE))

        projected = project_inference_payload(state)
        serialized = str(projected)

        assert set(projected) == {"input", "portfolio_model_context"}
        assert projected["input"] == {"is_synthetic": True}
        assert "Which covered-call candidate" in serialized
        assert "position:synthetic-tactical-nvda" in serialized
        assert "'symbol': 'NVDA'" in serialized
        assert "synthetic-indexed-portfolio-v2" not in serialized
        assert projected["portfolio_model_context"]["market_data"]["runtime_input_snapshot"][
            "content_hash"
        ]
        assert "gross_premium_usd" not in serialized
        assert "provider_contract_id" not in serialized
        assert "NVDA_SYNTH_CALL_160" not in serialized
        assert "'candidate_id': 'candidate-001'" in serialized
        assert projected["portfolio_model_context"]["market_data"]["mode"] == "locked"
    finally:
        session.close()


def test_model_cannot_reference_unknown_facts_or_candidates(session_factory) -> None:
    session = session_factory()
    try:
        state = analysis_for(session, deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE))
        response = InferenceResponse(
            output={
                "answer": {
                    "summary": "Unsupported reference.",
                    "assumptions": [],
                    "risks": [],
                    "fact_ids": ["position:invented"],
                    "candidate_ids": ["INVENTED_CONTRACT"],
                }
            },
            raw_text="{}",
        )

        with pytest.raises(ValueError, match="unknown facts or candidates"):
            merge_portfolio_query_explanation(state, response)
    finally:
        session.close()


def test_model_can_reference_only_the_aliased_candidate_id(session_factory) -> None:
    session = session_factory()
    try:
        state = analysis_for(session, deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE))
        response = InferenceResponse(
            output={
                "answer": {
                    "summary": "The deterministic leader is candidate-001.",
                    "assumptions": [],
                    "risks": [],
                    "fact_ids": [],
                    "candidate_ids": ["candidate-001"],
                }
            },
            raw_text="{}",
        )

        merged = merge_portfolio_query_explanation(state, response)

        assert merged["portfolio_query_explanation"]["answer"]["candidate_ids"] == ["candidate-001"]
        assert "provider_contract_id" not in str(project_inference_payload(state))
    finally:
        session.close()


def test_non_synthetic_snapshot_keeps_positions_out_of_traces_and_provider(
    session_factory,
) -> None:
    session = session_factory()
    try:
        ensure_seed_data(session)
        owner = session.query(AgentSystemRecord).filter_by(key="portfolio-analyst").one()
        document = deepcopy(SYNTHETIC_SNAPSHOT_DOCUMENT)
        document["is_synthetic"] = False
        snapshot = create_portfolio_snapshot(
            session,
            owner,
            snapshot_id="private-test-snapshot",
            label="Private test snapshot",
            as_of=document["as_of"],
            source_kind="indexed_run",
            is_synthetic=False,
            document=document,
        )
        request_input = deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE)
        state = analysis_for(session, request_input, portfolio_snapshot_id=snapshot.id)

        intermediate_trace_text = str(project_payload(state))
        provider_text = str(project_inference_payload(state))
        state["portfolio_query_explanation"] = {
            "answer": {
                "summary": "candidate-001 passed deterministic checks.",
                "assumptions": [],
                "risks": [],
                "fact_ids": [],
                "candidate_ids": ["candidate-001"],
            }
        }
        final_output = apply_portfolio_query_safety(state)["output"]
        final_trace = project_payload(final_output)
        final_trace_text = str(final_trace)

        for forbidden in (
            "'symbol':",
            "'shares':",
            "'largest_symbol':",
            "'gross_premium_usd':",
            "'provider_ref':",
        ):
            assert forbidden not in intermediate_trace_text
            assert forbidden not in provider_text
        assert final_trace["covered_call"]["candidates"][0]["symbol"] == "NVDA"
        assert "provider_contract_id" not in final_trace_text
        assert "NVDA_SYNTH_CALL_160" not in final_trace_text
        assert "'shares':" not in final_trace_text
        assert project_inference_payload(state)["input"] == {"is_synthetic": False}
    finally:
        session.close()


def test_direct_real_run_refreshes_and_fails_cleanly_without_provider_credentials(
    client,
    session_factory,
) -> None:
    session = session_factory()
    try:
        graph, prompt, _dataset = ensure_seed_data(session)
        system = session.get(AgentSystemRecord, graph.agent_system_id)
        owner = session.query(AgentSystemRecord).filter_by(key="portfolio-analyst").one()
        document = deepcopy(SYNTHETIC_SNAPSHOT_DOCUMENT)
        document["is_synthetic"] = False
        snapshot = create_portfolio_snapshot(
            session,
            owner,
            snapshot_id="private-refresh-without-provider",
            label="Private refresh without provider",
            as_of=document["as_of"],
            source_kind="indexed_run",
            is_synthetic=False,
            document=document,
        )
        request_input = deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE)

        response = client.post(
            "/api/traces/run",
            json={
                "agent_system_id": system.id,
                "agent_system_version_id": graph.id,
                "prompt_version_id": prompt.id,
                "model_id": "mock/portfolio-analyst",
                "input": request_input,
                "node_resource_selections": {
                    "get_indexed_portfolio": {
                        "mode": "locked",
                        "snapshot_id": snapshot.id,
                    }
                },
            },
        )

        assert response.status_code == 201
        payload = response.json()
        assert payload["status"] == "complete"
        assert payload["output"]["query"]["status"] == "missing_context"
        assert payload["output"]["market_data"]["mode"] == "refresh"
        assert payload["output"]["market_data"]["error_code"] == "provider_unconfigured"
        persisted = str(payload)
        assert "NVDA_SYNTH_CALL_160" not in persisted
        assert "provider_contract_id" not in persisted
        assert "'shares':" not in persisted
        assert "'symbol':" not in persisted
    finally:
        session.close()
