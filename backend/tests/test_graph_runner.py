from copy import deepcopy
from datetime import UTC, datetime

import pytest

from autoeval_api.config import Settings
from autoeval_api.graph.context import GraphRuntimeContext
from autoeval_api.graph.definition import AgentNodeDefinition
from autoeval_api.graph.registry import NodeHandlerRegistry
from autoeval_api.graph.runner import AgentGraphRunner, RunSelection, TraceContext
from autoeval_api.graph.runtime_inputs import RuntimeInputCapabilityRegistry
from autoeval_api.inference.base import InferenceRequest, InferenceResponse, ModelDescriptor
from autoeval_api.inference.registry import InferenceProviderRegistry
from autoeval_api.models import (
    AgentSystemRecord,
    AgentSystemVersionRecord,
    PromptRecord,
    PromptVersionRecord,
    RunStatus,
    TraceOrigin,
    TraceSpanRecord,
)
from autoeval_api.services.runtime_input_snapshots import create_runtime_input_snapshot
from autoeval_api.services.versioning import create_agent_version, create_prompt_version


class RecordingProvider:
    provider_id = "recording"

    def __init__(self) -> None:
        self.requests: list[InferenceRequest] = []

    def models(self) -> list[ModelDescriptor]:
        return [
            ModelDescriptor(
                id="recording/test",
                provider=self.provider_id,
                label="Recording test model",
                supports=("text",),
            )
        ]

    async def complete(self, request: InferenceRequest) -> InferenceResponse:
        self.requests.append(request)
        if request.task == "classify_incident":
            output = {
                "classification": {
                    "severity": "high",
                    "route": "payments",
                    "confidence": 0.9,
                    "evidence": ["checkout failures"],
                }
            }
        else:
            output = {
                "output": {
                    "severity": "high",
                    "route": "payments",
                    "requires_human": True,
                    "response": "Notify the payments on-call team.",
                }
            }
        return InferenceResponse(output=output, raw_text="{}")


@pytest.mark.asyncio
async def test_runner_records_every_graph_node(session_factory) -> None:
    session = session_factory()
    graph_version = session.query(AgentSystemVersionRecord).one()
    prompt = session.query(PromptRecord).filter_by(key="incident-triage-system").one()
    prompt_version = session.query(PromptVersionRecord).filter_by(prompt_id=prompt.id).one()
    runner = AgentGraphRunner(InferenceProviderRegistry(Settings(AUTOEVAL_ENV="test")))

    trace = await runner.run(
        session,
        RunSelection(graph_version, prompt_version, "mock/incident-specialist", "incident-triage"),
        {"text": "Checkout payment attempts fail for every customer.", "service": "checkout"},
    )

    spans = session.query(TraceSpanRecord).filter_by(trace_id=trace.id).all()
    assert trace.status == RunStatus.COMPLETE
    assert trace.output["severity"] == "high"
    assert trace.output["route"] == "payments"
    assert len(spans) == 4
    assert sum(span.input_tokens for span in spans) > 0
    llm_spans = [span for span in spans if span.node_kind == "llm"]
    assert all(span.output["_inference"] == {"deterministic": True} for span in llm_spans)


@pytest.mark.asyncio
async def test_runner_forwards_node_response_schema(session_factory) -> None:
    session = session_factory()
    graph_version = session.query(AgentSystemVersionRecord).one()
    prompt = session.query(PromptRecord).filter_by(key="incident-triage-system").one()
    prompt_version = session.query(PromptVersionRecord).filter_by(prompt_id=prompt.id).one()
    response_schema = {
        "type": "object",
        "properties": {"classification": {"type": "object"}},
        "required": ["classification"],
        "additionalProperties": False,
    }
    definition = deepcopy(graph_version.definition)
    classify_node = next(node for node in definition["nodes"] if node["id"] == "classify_incident")
    classify_node["response_schema"] = response_schema
    graph_version.definition = definition
    session.commit()

    provider = RecordingProvider()
    runner = AgentGraphRunner(InferenceProviderRegistry([provider]))
    trace = await runner.run(
        session,
        RunSelection(graph_version, prompt_version, "recording/test", "incident-triage"),
        {"text": "Checkout payment attempts fail.", "service": "checkout"},
    )

    assert trace.status == RunStatus.COMPLETE
    assert [item.response_schema for item in provider.requests] == [response_schema, None]


@pytest.mark.asyncio
async def test_failed_runtime_input_span_retains_prebound_snapshot_id(session_factory) -> None:
    session = session_factory()
    system = AgentSystemRecord(
        key="runtime-input-failure-test",
        name="Runtime input failure test",
        description="Test-only graph for failed span provenance.",
    )
    session.add(system)
    session.commit()
    prompt = PromptRecord(
        agent_system_id=system.id,
        key="runtime-input-failure-test-system",
        name="Runtime input failure prompt",
        description="Test-only prompt.",
    )
    session.add(prompt)
    session.commit()
    prompt_version = create_prompt_version(session, prompt, "Test prompt")
    graph_version = create_agent_version(
        session,
        system,
        {
            "entry_point": "fail_after_binding",
            "output_node": "fail_after_binding",
            "nodes": [
                {
                    "id": "fail_after_binding",
                    "label": "Fail after binding",
                    "kind": "deterministic",
                    "handler": "fail_after_binding",
                    "task": None,
                    "runtime_input_policy": {
                        "source": "options_chain",
                        "schema_version": 1,
                        "runtime_mode": "locked",
                        "evaluation_mode": "locked",
                    },
                }
            ],
            "edges": [],
        },
    )
    snapshot = create_runtime_input_snapshot(
        session,
        system,
        source_trace_id=None,
        node_id="fail_after_binding",
        source_key="options_chain",
        schema_version=1,
        observed_at=datetime(2026, 8, 10, 15, tzinfo=UTC),
        fetched_at=datetime(2026, 8, 10, 15, 1, tzinfo=UTC),
        provider="test-fixture",
        source_kind="test_fixture",
        is_synthetic=True,
        payload={"contracts": []},
        provenance={"status": "recorded"},
    )

    def fail_after_binding(_state, _context):
        raise RuntimeError("handler failed after runtime snapshot binding")

    node_registry = NodeHandlerRegistry()
    node_registry.register_contextual_deterministic(
        "fail_after_binding", fail_after_binding, system.key
    )
    runtime_inputs = RuntimeInputCapabilityRegistry()
    runtime_inputs.register("options_chain", object())
    runner = AgentGraphRunner(
        InferenceProviderRegistry(Settings(AUTOEVAL_ENV="test")),
        node_registry,
        runtime_inputs,
    )

    trace = await runner.run(
        session,
        RunSelection(graph_version, prompt_version, "mock/incident-specialist", system.key),
        {},
        TraceContext(origin_type=TraceOrigin.EVALUATION),
        runtime_input_snapshot_ids={"fail_after_binding": snapshot.id},
    )

    span = session.query(TraceSpanRecord).filter_by(trace_id=trace.id).one()
    assert trace.status == RunStatus.FAILED
    assert trace.runtime_input_snapshot_ids == {"fail_after_binding": snapshot.id}
    assert span.status == RunStatus.FAILED
    assert span.runtime_input_snapshot_id == snapshot.id
    assert span.node_snapshot_id == snapshot.id
    assert span.snapshot_role == "consumed"
    assert span.snapshot_resolution_mode == "replayed"


def test_required_node_snapshot_policy_fails_when_handler_does_not_bind(session_factory) -> None:
    session = session_factory()
    context = GraphRuntimeContext(session, "incident-triage")
    node = AgentNodeDefinition.model_validate(
        {
            "id": "persist_result",
            "label": "Persist result",
            "kind": "deterministic",
            "handler": "persist_result",
            "snapshot_policy": {
                "output_key": "normalized_result",
                "snapshot_kind": "node_output",
                "schema_version": 1,
                "binding_mode": "produce",
                "required": True,
            },
        }
    )

    with pytest.raises(RuntimeError, match="did not bind"):
        AgentGraphRunner._validate_node_snapshot_policy(context, node)

    context.bind_node_snapshot(
        "persist_result",
        "snapshot-id",
        role="produced",
        resolution_mode="computed",
        metadata={"output_key": "normalized_result", "schema_version": 1},
    )
    AgentGraphRunner._validate_node_snapshot_policy(context, node)
