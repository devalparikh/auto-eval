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
