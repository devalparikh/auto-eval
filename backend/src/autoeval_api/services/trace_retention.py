"""Expire unreferenced traces while preserving immutable provenance."""

import argparse
from datetime import timedelta

from sqlalchemy import exists
from sqlalchemy.orm import Session

from autoeval_api.models import (
    DatasetItemRecord,
    EvalItemResultRecord,
    NodeOutputSnapshotRecord,
    PortfolioSnapshotRecord,
    RunStatus,
    RuntimeInputSnapshotRecord,
    TraceRecord,
    TraceSpanRecord,
    utc_now,
)


def prune_traces(session: Session, retention_days: int, *, apply: bool = False) -> int:
    if retention_days < 1:
        raise ValueError("Trace retention must be at least one day")
    query = session.query(TraceRecord.id).filter(
        TraceRecord.status.in_([RunStatus.COMPLETE, RunStatus.FAILED]),
        TraceRecord.completed_at < utc_now() - timedelta(days=retention_days),
    )
    for reference in (
        DatasetItemRecord.source_trace_id,
        EvalItemResultRecord.trace_id,
        NodeOutputSnapshotRecord.source_trace_id,
        PortfolioSnapshotRecord.source_trace_id,
        RuntimeInputSnapshotRecord.source_trace_id,
    ):
        query = query.filter(~exists().where(reference == TraceRecord.id))
    if not apply:
        return query.count()
    removed = 0
    while rows := query.limit(500).all():
        identifiers = [row.id for row in rows]
        session.query(TraceSpanRecord).filter(TraceSpanRecord.trace_id.in_(identifiers)).delete(
            synchronize_session=False
        )
        session.query(TraceRecord).filter(TraceRecord.id.in_(identifiers)).delete(
            synchronize_session=False
        )
        # Foreign keys make a concurrent provenance reference fail safely.
        session.commit()
        removed += len(identifiers)
    return removed


def main() -> None:
    from autoeval_api.config import get_settings
    from autoeval_api.db import SessionLocal

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Delete eligible traces and spans")
    options = parser.parse_args()
    with SessionLocal() as session:
        count = prune_traces(session, get_settings().trace_retention_days, apply=options.apply)
    print(f"{'Deleted' if options.apply else 'Eligible traces:'} {count}")


if __name__ == "__main__":
    main()
