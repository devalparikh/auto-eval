from typing import Any

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from autoeval_api.models import (
    AgentSystemVersionRecord,
    DatasetItemRecord,
    DatasetRecord,
    DatasetStatus,
    DatasetVersionRecord,
    RunStatus,
    TraceRecord,
    utc_now,
)
from autoeval_api.schemas import (
    DatasetItemResponse,
    DatasetSummary,
    DatasetVersionDetail,
    DatasetVersionSummary,
)


def get_dataset_version(session: Session, version_id: str) -> DatasetVersionRecord:
    version = session.get(DatasetVersionRecord, version_id)
    if version is None:
        raise LookupError("Dataset version not found")
    return version


def require_draft(version: DatasetVersionRecord) -> None:
    if version.status != DatasetStatus.DRAFT:
        raise ValueError("Final dataset versions are immutable. Create a new draft version.")


def create_dataset_version(
    session: Session,
    dataset: DatasetRecord,
    clone_from_version_id: str | None = None,
) -> DatasetVersionRecord:
    current = (
        session.query(func.max(DatasetVersionRecord.version))
        .filter_by(dataset_id=dataset.id)
        .scalar()
        or 0
    )
    version = DatasetVersionRecord(
        dataset_id=dataset.id,
        version=current + 1,
        status=DatasetStatus.DRAFT,
    )
    session.add(version)
    session.flush()

    if clone_from_version_id:
        source = get_dataset_version(session, clone_from_version_id)
        if source.dataset_id != dataset.id:
            raise ValueError("Clone source belongs to another dataset")
        source_items = session.query(DatasetItemRecord).filter_by(dataset_version_id=source.id)
        for item in source_items:
            session.add(
                DatasetItemRecord(
                    dataset_version_id=version.id,
                    input=item.input,
                    expected=item.expected,
                    source_trace_id=item.source_trace_id,
                )
            )
    session.commit()
    session.refresh(version)
    return version


def add_dataset_item(
    session: Session,
    version: DatasetVersionRecord,
    input_payload: dict[str, Any],
    expected: dict[str, Any],
) -> DatasetItemRecord:
    require_draft(version)
    item = DatasetItemRecord(
        dataset_version_id=version.id,
        input=input_payload,
        expected=expected,
    )
    session.add(item)
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise ValueError("Dataset version is no longer an editable draft") from error
    session.refresh(item)
    return item


def add_trace_to_dataset(
    session: Session,
    version: DatasetVersionRecord,
    trace: TraceRecord,
    expected: dict[str, Any],
) -> tuple[DatasetItemRecord, bool]:
    require_draft(version)
    if trace.status != RunStatus.COMPLETE:
        raise ValueError("Only complete traces can be added to a dataset")
    dataset = session.get(DatasetRecord, version.dataset_id)
    graph_version = session.get(AgentSystemVersionRecord, trace.agent_system_version_id)
    if dataset is None or graph_version is None:
        raise LookupError("Dataset or trace agent system not found")
    if dataset.agent_system_id != graph_version.agent_system_id:
        raise ValueError("Trace and dataset belong to different agent systems")

    existing = _trace_item(session, version.id, trace.id)
    if existing is not None:
        if existing.expected != expected:
            raise ValueError(
                f"Trace is already included with different expected values ({existing.id})"
            )
        return existing, False

    item = DatasetItemRecord(
        dataset_version_id=version.id,
        input=trace.request_input,
        expected=expected,
        source_trace_id=trace.id,
    )
    session.add(item)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        existing = _trace_item(session, version.id, trace.id)
        if existing is None:
            raise ValueError("Dataset version is no longer an editable draft") from None
        if existing.expected != expected:
            raise ValueError(
                f"Trace is already included with different expected values ({existing.id})"
            ) from None
        return existing, False
    session.refresh(item)
    return item, True


def _trace_item(session: Session, version_id: str, trace_id: str) -> DatasetItemRecord | None:
    return (
        session.query(DatasetItemRecord)
        .filter_by(dataset_version_id=version_id, source_trace_id=trace_id)
        .first()
    )


def update_dataset_item(
    session: Session,
    item: DatasetItemRecord,
    input_payload: dict[str, Any] | None,
    expected: dict[str, Any],
) -> DatasetItemRecord:
    version = get_dataset_version(session, item.dataset_version_id)
    require_draft(version)
    if item.source_trace_id is not None:
        if input_payload is not None and input_payload != item.input:
            raise ValueError("Trace-derived inputs are immutable; update expected values only")
    elif input_payload is not None:
        item.input = input_payload
    item.expected = expected
    item.updated_at = utc_now()
    session.add(item)
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise ValueError("Dataset version is no longer an editable draft") from error
    session.refresh(item)
    return item


def finalize_dataset_version(
    session: Session, version: DatasetVersionRecord
) -> DatasetVersionRecord:
    require_draft(version)
    item_count = session.query(DatasetItemRecord).filter_by(dataset_version_id=version.id).count()
    if item_count == 0:
        raise ValueError("A dataset version must have at least one item before finalizing")
    version.status = DatasetStatus.FINAL
    version.finalized_at = utc_now()
    session.add(version)
    session.commit()
    session.refresh(version)
    return version


def dataset_summary(session: Session, dataset: DatasetRecord) -> DatasetSummary:
    versions = (
        session.query(DatasetVersionRecord)
        .filter_by(dataset_id=dataset.id)
        .order_by(DatasetVersionRecord.version.desc())
        .all()
    )
    return DatasetSummary(
        id=dataset.id,
        agent_system_id=dataset.agent_system_id,
        key=dataset.key,
        name=dataset.name,
        description=dataset.description,
        versions=[dataset_version_summary(session, item) for item in versions],
    )


def dataset_version_summary(
    session: Session, version: DatasetVersionRecord
) -> DatasetVersionSummary:
    item_count = (
        session.query(func.count(DatasetItemRecord.id))
        .filter_by(dataset_version_id=version.id)
        .scalar()
    )
    return DatasetVersionSummary(
        id=version.id,
        version=version.version,
        status=version.status,
        item_count=item_count or 0,
        created_at=version.created_at,
        finalized_at=version.finalized_at,
    )


def dataset_version_detail(session: Session, version: DatasetVersionRecord) -> DatasetVersionDetail:
    items = (
        session.query(DatasetItemRecord)
        .filter_by(dataset_version_id=version.id)
        .order_by(DatasetItemRecord.created_at)
        .all()
    )
    summary = dataset_version_summary(session, version)
    return DatasetVersionDetail(
        **summary.model_dump(),
        dataset_id=version.dataset_id,
        items=[DatasetItemResponse.model_validate(item, from_attributes=True) for item in items],
    )
