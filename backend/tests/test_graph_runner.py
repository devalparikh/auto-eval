from copy import deepcopy

import pytest

from autoeval_api.config import Settings
from autoeval_api.graph.runner import AgentGraphRunner, RunSelection
from autoeval_api.inference.base import InferenceRequest, InferenceResponse, ModelDescriptor
from autoeval_api.inference.registry import InferenceProviderRegistry
from autoeval_api.models import (
    AgentSystemVersionRecord,
    PromptRecord,
    PromptVersionRecord,
    RunStatus,
    TraceSpanRecord,
)


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
