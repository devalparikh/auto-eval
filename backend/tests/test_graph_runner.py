import pytest

from autoeval_api.config import Settings
from autoeval_api.graph.runner import AgentGraphRunner, RunSelection
from autoeval_api.inference.registry import InferenceProviderRegistry
from autoeval_api.models import (
    AgentSystemVersionRecord,
    PromptVersionRecord,
    RunStatus,
    TraceSpanRecord,
)


@pytest.mark.asyncio
async def test_runner_records_every_graph_node(session_factory) -> None:
    session = session_factory()
    graph_version = session.query(AgentSystemVersionRecord).one()
    prompt_version = session.query(PromptVersionRecord).one()
    runner = AgentGraphRunner(InferenceProviderRegistry(Settings(AUTOEVAL_ENV="test")))

    trace = await runner.run(
        session,
        RunSelection(graph_version, prompt_version, "mock/incident-specialist"),
        {"text": "Checkout payment attempts fail for every customer.", "service": "checkout"},
    )

    spans = session.query(TraceSpanRecord).filter_by(trace_id=trace.id).all()
    assert trace.status == RunStatus.COMPLETE
    assert trace.output["severity"] == "high"
    assert trace.output["route"] == "payments"
    assert len(spans) == 4
    assert sum(span.input_tokens for span in spans) > 0
