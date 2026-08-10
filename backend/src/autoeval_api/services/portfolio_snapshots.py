from copy import deepcopy
from typing import Any

from sqlalchemy.orm import Session

from autoeval_api.agent_systems.portfolio_query.snapshot import snapshot_content_hash
from autoeval_api.models import AgentSystemRecord, PortfolioSnapshotRecord
from autoeval_api.schemas import PortfolioSnapshotDetail, PortfolioSnapshotSummary


def create_portfolio_snapshot(
    session: Session,
    owner: AgentSystemRecord,
    *,
    snapshot_id: str,
    label: str,
    as_of: str,
    source_kind: str,
    is_synthetic: bool,
    document: dict[str, Any],
    source_trace_id: str | None = None,
) -> PortfolioSnapshotRecord:
    normalized = deepcopy(document)
    normalized["schema_version"] = int(normalized.get("schema_version", 1))
    normalized["as_of"] = as_of
    normalized["is_synthetic"] = is_synthetic
    positions = normalized.get("positions")
    if not isinstance(positions, list) or not positions:
        raise ValueError("Portfolio snapshot requires at least one position")
    content_hash = snapshot_content_hash(normalized)

    existing = session.get(PortfolioSnapshotRecord, snapshot_id)
    if existing is not None:
        if existing.agent_system_id != owner.id or existing.content_hash != content_hash:
            raise ValueError(
                f"Portfolio snapshot ID already exists with different content: {snapshot_id}"
            )
        return existing

    record = PortfolioSnapshotRecord(
        id=snapshot_id,
        agent_system_id=owner.id,
        source_trace_id=source_trace_id,
        schema_version=normalized["schema_version"],
        label=label,
        as_of=as_of,
        source_kind=source_kind,
        is_synthetic=is_synthetic,
        content_hash=content_hash,
        document=normalized,
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    return record


def resolve_portfolio_snapshot(
    session: Session,
    snapshot_id: str,
    *,
    owner_system_key: str = "portfolio-analyst",
) -> tuple[PortfolioSnapshotRecord, dict[str, Any]]:
    record = session.get(PortfolioSnapshotRecord, snapshot_id)
    if record is None:
        raise ValueError(f"Portfolio snapshot not found: {snapshot_id}")
    owner = session.get(AgentSystemRecord, record.agent_system_id)
    if owner is None or owner.key != owner_system_key:
        raise ValueError("Portfolio snapshot belongs to another agent system")
    actual_hash = snapshot_content_hash(record.document)
    if actual_hash != record.content_hash:
        raise ValueError("Stored portfolio snapshot failed content-hash validation")
    hydrated = {
        "id": record.id,
        "content_hash": record.content_hash,
        **deepcopy(record.document),
    }
    return record, hydrated


def list_portfolio_snapshots(
    session: Session,
    agent_system_id: str | None = None,
) -> list[PortfolioSnapshotRecord]:
    query = session.query(PortfolioSnapshotRecord)
    if agent_system_id:
        query = query.filter_by(agent_system_id=agent_system_id)
    return query.order_by(PortfolioSnapshotRecord.created_at.desc()).all()


def portfolio_snapshot_summary(record: PortfolioSnapshotRecord) -> PortfolioSnapshotSummary:
    return PortfolioSnapshotSummary(
        id=record.id,
        agent_system_id=record.agent_system_id,
        source_trace_id=record.source_trace_id,
        schema_version=record.schema_version,
        label=record.label,
        as_of=record.as_of,
        source_kind=record.source_kind,
        is_synthetic=record.is_synthetic,
        content_hash=record.content_hash,
        position_count=_position_count(record.document),
        created_at=record.created_at,
    )


def portfolio_snapshot_detail(record: PortfolioSnapshotRecord) -> PortfolioSnapshotDetail:
    actual_hash = snapshot_content_hash(record.document)
    if actual_hash != record.content_hash:
        raise ValueError("Stored portfolio snapshot failed content-hash validation")
    content = (
        deepcopy(record.document) if record.is_synthetic else _redacted_content(record.document)
    )
    return PortfolioSnapshotDetail(
        **portfolio_snapshot_summary(record).model_dump(),
        content_available=True,
        content=content,
    )


def _position_count(document: dict[str, Any]) -> int:
    positions = document.get("positions")
    return len(positions) if isinstance(positions, list) else 0


def _redacted_content(document: dict[str, Any]) -> dict[str, Any]:
    """Expose useful shape/policy metadata without real identifiers or position sizing."""
    safe_categorical_fields = {
        "instrument_type",
        "asset_class",
        "bucket",
        "covered_calls_allowed",
        "assignment_acceptable",
        "do_not_touch",
        "tags",
    }
    positions = document.get("positions")
    projected_positions: list[dict[str, Any]] = []
    omitted_position_fields: set[str] = set()
    if isinstance(positions, list):
        for index, raw_position in enumerate(positions, start=1):
            if not isinstance(raw_position, dict):
                projected_positions.append(
                    {"position": index, "shape": type(raw_position).__name__}
                )
                continue
            omitted_position_fields.update(set(raw_position) - safe_categorical_fields)
            projected_positions.append(
                {
                    "position": index,
                    **{
                        key: deepcopy(value)
                        for key, value in raw_position.items()
                        if key in safe_categorical_fields
                    },
                }
            )
    omitted_top_level_fields = sorted(
        set(document) - {"schema_version", "as_of", "is_synthetic", "positions"}
    )
    return {
        "schema_version": document.get("schema_version"),
        "as_of": document.get("as_of"),
        "is_synthetic": False,
        "positions": projected_positions,
        "redaction": {
            "applied": True,
            "omitted_top_level_fields": omitted_top_level_fields,
            "omitted_position_fields": sorted(omitted_position_fields),
        },
    }
