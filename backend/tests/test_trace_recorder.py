from copy import deepcopy

from autoeval_api.config import Settings
from autoeval_api.graph.trace_recorder import TraceRecorder
from autoeval_api.models import (
    AgentSystemVersionRecord,
    PromptVersionRecord,
    RunStatus,
    TraceRecord,
    TraceSpanRecord,
)


def _base_trace(graph_version_id: str, prompt_version_id: str) -> TraceRecord:
    return TraceRecord(
        status=RunStatus.RUNNING,
        agent_system_version_id=graph_version_id,
        prompt_version_id=prompt_version_id,
        prompt_version_ids={},
        model_id="mock/test-model",
        request_input={},
    )


def test_start_span_commits_running_row_visible_before_finish(session_factory) -> None:
    writer_session = session_factory()
    graph_version = writer_session.query(AgentSystemVersionRecord).first()
    prompt_version = writer_session.query(PromptVersionRecord).first()
    assert graph_version is not None
    assert prompt_version is not None

    recorder = TraceRecorder(writer_session)
    trace = _base_trace(graph_version.id, prompt_version.id)
    recorder.start_trace(trace)

    span = TraceSpanRecord(
        trace_id=trace.id,
        node_id="classify",
        node_kind="deterministic",
        sequence=0,
        status=RunStatus.RUNNING,
        input={},
    )
    recorder.start_span(span)

    reader_session = session_factory()
    try:
        stored = reader_session.get(TraceSpanRecord, span.id)
        assert stored is not None
        assert stored.status == RunStatus.RUNNING
        assert stored.completed_at is None
    finally:
        reader_session.close()

    span.status = RunStatus.COMPLETE
    span.cost_usd = 0.01
    span.input_tokens = 10
    span.output_tokens = 5
    recorder.finish_span(span)

    reader_session = session_factory()
    try:
        stored = reader_session.get(TraceSpanRecord, span.id)
        assert stored is not None
        assert stored.status == RunStatus.COMPLETE
        assert stored.cost_usd == 0.01
    finally:
        reader_session.close()

    writer_session.close()


def test_finish_trace_aggregates_cost_and_tokens_across_spans(session_factory) -> None:
    session = session_factory()
    graph_version = session.query(AgentSystemVersionRecord).first()
    prompt_version = session.query(PromptVersionRecord).first()
    assert graph_version is not None
    assert prompt_version is not None

    recorder = TraceRecorder(session)
    trace = _base_trace(graph_version.id, prompt_version.id)
    recorder.start_trace(trace)

    span_one = TraceSpanRecord(
        trace_id=trace.id,
        node_id="classify",
        node_kind="deterministic",
        sequence=0,
        status=RunStatus.COMPLETE,
        input={},
        cost_usd=0.001,
        input_tokens=100,
        output_tokens=20,
    )
    span_two = TraceSpanRecord(
        trace_id=trace.id,
        node_id="respond",
        node_kind="llm",
        sequence=1,
        status=RunStatus.COMPLETE,
        input={},
        cost_usd=0.002,
        input_tokens=50,
        output_tokens=30,
    )
    recorder.start_span(span_one)
    recorder.finish_span(span_one)
    recorder.start_span(span_two)
    recorder.finish_span(span_two)

    trace.status = RunStatus.COMPLETE
    recorder.finish_trace(trace, None)

    assert trace.cost_usd == 0.003
    assert trace.input_tokens == 150
    assert trace.output_tokens == 50

    session.close()


def test_recorder_redacts_every_persistence_boundary_without_changing_business_input(
    session_factory,
):
    with session_factory() as session:
        graph = session.query(AgentSystemVersionRecord).first()
        prompt = session.query(PromptVersionRecord).first()
        business_input = {
            "text": "Contact person@example.com with Bearer abcdef1234567890",
            "nested": [{"apiKey": "do-not-store", "full_name": "Jane Smith"}],
            "token_count": 42,
        }
        original = deepcopy(business_input)
        recorder = TraceRecorder(
            session,
            Settings(_env_file=None, OPENROUTER_API_KEY="configured-private-value"),
        )
        trace = _base_trace(graph.id, prompt.id)
        trace.request_input = business_input
        recorder.start_trace(trace)
        span = TraceSpanRecord(
            trace_id=trace.id,
            node_id="test",
            node_kind="llm",
            sequence=0,
            input=business_input,
            system_prompt="Use configured-private-value",
        )
        recorder.start_span(span)
        span.output = {"password": "another-secret", "message": "person@example.com"}
        span.error = "Echoed configured-private-value"
        recorder.finish_span(span)
        trace.output = {"authorization": "private authorization"}
        trace.error = "Echoed configured-private-value"
        recorder.finish_trace(trace, None)
        session.expire_all()
        stored = session.get(TraceRecord, trace.id)
        stored_span = session.get(TraceSpanRecord, span.id)
        assert stored.request_input["nested"][0] == {
            "apiKey": "[redacted]",
            "full_name": "[redacted]",
        }
        assert "example.com" not in stored.request_input["text"]
        assert "abcdef" not in stored.request_input["text"]
        assert stored.request_input["token_count"] == 42
        assert stored.output == {"authorization": "[redacted]"}
        assert stored.error == "Echoed [redacted]"
        assert stored_span.output == {"password": "[redacted]", "message": "[redacted]"}
        assert stored_span.error == "Echoed [redacted]"
        assert stored_span.system_prompt == "Use [redacted]"
        assert business_input == original
