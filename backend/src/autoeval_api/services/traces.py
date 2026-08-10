from sqlalchemy.orm import Session

from autoeval_api.models import AgentSystemVersionRecord, TraceRecord, TraceSpanRecord
from autoeval_api.schemas import TraceResponse, TraceSpanResponse


def list_traces(session: Session, limit: int = 50) -> list[TraceRecord]:
    return session.query(TraceRecord).order_by(TraceRecord.started_at.desc()).limit(limit).all()


def trace_response(
    session: Session, trace: TraceRecord, include_graph: bool = True
) -> TraceResponse:
    spans = (
        session.query(TraceSpanRecord)
        .filter_by(trace_id=trace.id)
        .order_by(TraceSpanRecord.sequence, TraceSpanRecord.started_at)
        .all()
    )
    graph_definition = None
    if include_graph:
        graph_version = session.get(AgentSystemVersionRecord, trace.agent_system_version_id)
        graph_definition = graph_version.definition if graph_version else None
    return TraceResponse(
        id=trace.id,
        status=trace.status,
        agent_system_version_id=trace.agent_system_version_id,
        prompt_version_id=trace.prompt_version_id,
        model_id=trace.model_id,
        request_input=trace.request_input,
        output=trace.output,
        error=trace.error,
        latency_ms=trace.latency_ms,
        cost_usd=trace.cost_usd,
        input_tokens=trace.input_tokens,
        output_tokens=trace.output_tokens,
        started_at=trace.started_at,
        completed_at=trace.completed_at,
        graph_definition=graph_definition,
        spans=[TraceSpanResponse.model_validate(span, from_attributes=True) for span in spans],
    )
