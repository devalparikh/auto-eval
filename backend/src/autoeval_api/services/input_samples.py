from typing import Any

from sqlalchemy.orm import Session

from autoeval_api.models import (
    AgentInputSampleRecord,
    AgentSystemRecord,
    AgentSystemVersionRecord,
    RunStatus,
    TraceRecord,
)


def create_input_sample(
    session: Session,
    system: AgentSystemRecord,
    trace: TraceRecord,
    input_value: dict[str, Any],
) -> AgentInputSampleRecord:
    graph_version = session.get(AgentSystemVersionRecord, trace.agent_system_version_id)
    if graph_version is None or graph_version.agent_system_id != system.id:
        raise ValueError("Source trace belongs to another agent system")
    if trace.status != RunStatus.COMPLETE:
        raise ValueError("Only completed trace inputs can be saved as samples")

    existing = (
        session.query(AgentInputSampleRecord)
        .filter_by(agent_system_id=system.id, source_trace_id=trace.id)
        .first()
    )
    if existing is not None:
        return existing

    sample = AgentInputSampleRecord(
        agent_system_id=system.id,
        source_trace_id=trace.id,
        input=input_value,
    )
    session.add(sample)
    session.commit()
    session.refresh(sample)
    return sample


def list_input_samples(
    session: Session,
    system_id: str,
    limit: int = 100,
) -> list[AgentInputSampleRecord]:
    return (
        session.query(AgentInputSampleRecord)
        .filter_by(agent_system_id=system_id)
        .order_by(AgentInputSampleRecord.created_at.desc())
        .limit(limit)
        .all()
    )
