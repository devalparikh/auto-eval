from sqlalchemy import distinct, func
from sqlalchemy.orm import Session

from autoeval_api.models import (
    AgentSystemRecord,
    AgentSystemVersionRecord,
    DatasetItemRecord,
    DatasetRecord,
    DatasetStatus,
    DatasetVersionRecord,
    RunStatus,
    TraceOrigin,
    TraceRecord,
    TraceSpanRecord,
)
from autoeval_api.schemas import (
    DatasetMembershipResponse,
    DatasetTargetResponse,
    TraceDatasetTargetsResponse,
    TraceResponse,
    TraceSpanResponse,
)


def list_traces(
    session: Session,
    limit: int = 50,
    agent_system_id: str | None = None,
) -> list[TraceRecord]:
    query = session.query(TraceRecord)
    if agent_system_id:
        query = query.join(
            AgentSystemVersionRecord,
            AgentSystemVersionRecord.id == TraceRecord.agent_system_version_id,
        ).filter(AgentSystemVersionRecord.agent_system_id == agent_system_id)
    return query.order_by(TraceRecord.started_at.desc()).limit(limit).all()


def list_trace_responses(
    session: Session,
    limit: int = 50,
    agent_system_id: str | None = None,
) -> list[TraceResponse]:
    traces = list_traces(session, limit, agent_system_id)
    if not traces:
        return []
    trace_ids = [trace.id for trace in traces]
    version_ids = {trace.agent_system_version_id for trace in traces}
    versions = {
        version.id: version
        for version in session.query(AgentSystemVersionRecord)
        .filter(AgentSystemVersionRecord.id.in_(version_ids))
        .all()
    }
    system_ids = {version.agent_system_id for version in versions.values()}
    systems = {
        system.id: system
        for system in session.query(AgentSystemRecord)
        .filter(AgentSystemRecord.id.in_(system_ids))
        .all()
    }
    counts = _membership_counts(session, trace_ids)
    return [
        _trace_response(
            trace,
            versions[trace.agent_system_version_id],
            systems[versions[trace.agent_system_version_id].agent_system_id],
            membership_count=counts.get(trace.id, (0, 0))[0],
            dataset_count=counts.get(trace.id, (0, 0))[1],
        )
        for trace in traces
    ]


def trace_response(
    session: Session, trace: TraceRecord, include_graph: bool = True
) -> TraceResponse:
    graph_version = session.get(AgentSystemVersionRecord, trace.agent_system_version_id)
    if graph_version is None:
        raise LookupError("Trace graph version not found")
    system = session.get(AgentSystemRecord, graph_version.agent_system_id)
    if system is None:
        raise LookupError("Trace agent system not found")
    spans = (
        session.query(TraceSpanRecord)
        .filter_by(trace_id=trace.id)
        .order_by(TraceSpanRecord.sequence, TraceSpanRecord.started_at)
        .all()
    )
    memberships = trace_memberships(session, trace.id)
    return _trace_response(
        trace,
        graph_version,
        system,
        graph_definition=graph_version.definition if include_graph else None,
        spans=spans,
        memberships=memberships,
    )


def trace_dataset_targets(session: Session, trace: TraceRecord) -> TraceDatasetTargetsResponse:
    graph_version = session.get(AgentSystemVersionRecord, trace.agent_system_version_id)
    if graph_version is None:
        raise LookupError("Trace graph version not found")
    memberships = trace_memberships(session, trace.id)
    existing_by_version = {
        membership.dataset_version_id: membership.dataset_item_id for membership in memberships
    }
    datasets = (
        session.query(DatasetRecord)
        .filter_by(agent_system_id=graph_version.agent_system_id)
        .order_by(DatasetRecord.name)
        .all()
    )
    same_source_dataset_id = _evaluation_source_dataset_id(session, trace)
    evaluation_item = (
        session.get(DatasetItemRecord, trace.evaluation_dataset_item_id)
        if trace.evaluation_dataset_item_id
        else None
    )
    targets: list[DatasetTargetResponse] = []
    for dataset in datasets:
        versions = (
            session.query(DatasetVersionRecord)
            .filter_by(dataset_id=dataset.id, status=DatasetStatus.DRAFT)
            .order_by(DatasetVersionRecord.version.desc())
            .all()
        )
        for version in versions:
            existing_item_id = existing_by_version.get(version.id)
            reason = None
            if existing_item_id:
                reason = "already_in_version"
            elif trace.status != RunStatus.COMPLETE:
                reason = "trace_not_complete"
            warnings: list[str] = []
            if trace.origin_type == TraceOrigin.EVALUATION:
                warnings.append("evaluation_origin")
            if same_source_dataset_id == dataset.id:
                warnings.append("same_source_dataset")
            targets.append(
                DatasetTargetResponse(
                    dataset_id=dataset.id,
                    dataset_key=dataset.key,
                    dataset_name=dataset.name,
                    dataset_version_id=version.id,
                    dataset_version=version.version,
                    eligible=reason is None,
                    existing_item_id=existing_item_id,
                    reason=reason,
                    warnings=warnings,
                )
            )
    return TraceDatasetTargetsResponse(
        trace_id=trace.id,
        memberships=memberships,
        targets=targets,
        evaluation_expected=evaluation_item.expected if evaluation_item else None,
        evaluation_actual=trace.output if evaluation_item else None,
    )


def trace_memberships(session: Session, trace_id: str) -> list[DatasetMembershipResponse]:
    rows = (
        session.query(DatasetItemRecord, DatasetVersionRecord, DatasetRecord)
        .join(
            DatasetVersionRecord,
            DatasetVersionRecord.id == DatasetItemRecord.dataset_version_id,
        )
        .join(DatasetRecord, DatasetRecord.id == DatasetVersionRecord.dataset_id)
        .filter(DatasetItemRecord.source_trace_id == trace_id)
        .order_by(DatasetRecord.name, DatasetVersionRecord.version.desc())
        .all()
    )
    return [_membership_response(item, version, dataset) for item, version, dataset in rows]


def _membership_counts(session: Session, trace_ids: list[str]) -> dict[str, tuple[int, int]]:
    rows = (
        session.query(
            DatasetItemRecord.source_trace_id,
            func.count(DatasetItemRecord.id),
            func.count(distinct(DatasetVersionRecord.dataset_id)),
        )
        .join(
            DatasetVersionRecord,
            DatasetVersionRecord.id == DatasetItemRecord.dataset_version_id,
        )
        .filter(DatasetItemRecord.source_trace_id.in_(trace_ids))
        .group_by(DatasetItemRecord.source_trace_id)
        .all()
    )
    return {
        trace_id: (version_count, dataset_count) for trace_id, version_count, dataset_count in rows
    }


def _evaluation_source_dataset_id(session: Session, trace: TraceRecord) -> str | None:
    if trace.evaluation_dataset_item_id is None:
        return None
    item = session.get(DatasetItemRecord, trace.evaluation_dataset_item_id)
    if item is None:
        return None
    version = session.get(DatasetVersionRecord, item.dataset_version_id)
    return version.dataset_id if version else None


def _membership_response(
    item: DatasetItemRecord,
    version: DatasetVersionRecord,
    dataset: DatasetRecord,
) -> DatasetMembershipResponse:
    return DatasetMembershipResponse(
        dataset_id=dataset.id,
        dataset_key=dataset.key,
        dataset_name=dataset.name,
        dataset_version_id=version.id,
        dataset_version=version.version,
        dataset_version_status=version.status,
        dataset_item_id=item.id,
        created_at=item.created_at,
    )


def _trace_response(
    trace: TraceRecord,
    graph_version: AgentSystemVersionRecord,
    system: AgentSystemRecord,
    *,
    graph_definition: dict | None = None,
    spans: list[TraceSpanRecord] | None = None,
    memberships: list[DatasetMembershipResponse] | None = None,
    membership_count: int | None = None,
    dataset_count: int | None = None,
) -> TraceResponse:
    memberships = memberships or []
    return TraceResponse(
        id=trace.id,
        status=trace.status,
        agent_system_id=system.id,
        agent_system_key=system.key,
        agent_system_name=system.name,
        agent_system_version_id=trace.agent_system_version_id,
        prompt_version_id=trace.prompt_version_id,
        prompt_version_ids=trace.prompt_version_ids or {},
        runtime_input_snapshot_ids=trace.runtime_input_snapshot_ids or {},
        node_snapshot_ids=trace.node_snapshot_ids or {},
        origin_type=trace.origin_type,
        evaluation_run_id=trace.evaluation_run_id,
        evaluation_dataset_item_id=trace.evaluation_dataset_item_id,
        dataset_membership_count=(
            membership_count if membership_count is not None else len(memberships)
        ),
        dataset_count=(
            dataset_count
            if dataset_count is not None
            else len({membership.dataset_id for membership in memberships})
        ),
        dataset_memberships=memberships,
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
        spans=[
            TraceSpanResponse.model_validate(span, from_attributes=True) for span in (spans or [])
        ],
    )
