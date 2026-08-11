from __future__ import annotations

import json
from collections import defaultdict
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import or_
from sqlalchemy.orm import Session

from autoeval_api.agent_systems.registry import system_spec
from autoeval_api.models import (
    AgentSystemRecord,
    AgentSystemVersionRecord,
    NodeOutputSnapshotRecord,
    PortfolioSnapshotRecord,
    RuntimeInputSnapshotRecord,
    TraceRecord,
    TraceSpanRecord,
)
from autoeval_api.schemas import (
    NodeSnapshotDetail,
    NodeSnapshotSummary,
    NodeSnapshotUsage,
)
from autoeval_api.services.portfolio_snapshots import portfolio_snapshot_detail
from autoeval_api.services.runtime_input_snapshots import runtime_input_snapshot_detail


def list_node_snapshots(
    session: Session,
    *,
    agent_system_id: str | None = None,
    product_key: str | None = None,
    node_id: str | None = None,
    limit: int = 200,
) -> list[NodeSnapshotSummary]:
    owners = _owners(session, agent_system_id=agent_system_id, product_key=product_key)
    owner_ids = [owner.id for owner in owners]
    if not owner_ids:
        return []
    owner_by_id = {owner.id: owner for owner in owners}
    query = session.query(NodeOutputSnapshotRecord).filter(
        NodeOutputSnapshotRecord.agent_system_id.in_(owner_ids)
    )
    if node_id:
        query = query.filter_by(node_id=node_id)
    records = (
        query.order_by(
            NodeOutputSnapshotRecord.observed_at.desc(),
            NodeOutputSnapshotRecord.captured_at.desc(),
        )
        .limit(limit)
        .all()
    )
    usages = _usages_by_snapshot(session, [record.id for record in records])
    labels = _node_labels(session, owners)
    return [
        _summary(
            record,
            owner_by_id[record.agent_system_id],
            labels,
            usages.get(record.id, []),
        )
        for record in records
    ]


def node_snapshot_detail(session: Session, snapshot_id: str) -> NodeSnapshotDetail:
    record = session.get(NodeOutputSnapshotRecord, snapshot_id)
    if record is None:
        raise LookupError("Node snapshot not found")
    owner = session.get(AgentSystemRecord, record.agent_system_id)
    if owner is None:
        raise LookupError("Node snapshot owner not found")
    usages = _usages_by_snapshot(session, [snapshot_id]).get(snapshot_id, [])
    labels = _node_labels(session, [owner])
    summary = _summary(record, owner, labels, usages)
    provenance, content = _revealed_content(session, record)
    return NodeSnapshotDetail(
        **summary.model_dump(),
        provenance=provenance,
        node_metadata=deepcopy(record.node_metadata or {}),
        usages=usages,
        content_available=True,
        content=content,
    )


def _owners(
    session: Session,
    *,
    agent_system_id: str | None,
    product_key: str | None,
) -> list[AgentSystemRecord]:
    if agent_system_id:
        owner = session.get(AgentSystemRecord, agent_system_id)
        if owner is None:
            raise LookupError("Agent system not found")
        return [owner]
    owners = session.query(AgentSystemRecord).all()
    if product_key:
        owners = [
            owner
            for owner in owners
            if (system_spec(owner.key).product_key or owner.key) == product_key
        ]
    return owners


def _node_labels(
    session: Session,
    owners: list[AgentSystemRecord],
) -> dict[tuple[str, str], str]:
    labels: dict[tuple[str, str], str] = {}
    for owner in owners:
        versions = (
            session.query(AgentSystemVersionRecord)
            .filter_by(agent_system_id=owner.id)
            .order_by(AgentSystemVersionRecord.version.desc())
            .all()
        )
        for version in versions:
            for node in version.definition.get("nodes", []):
                node_id = str(node.get("id", ""))
                if node_id:
                    labels.setdefault((owner.id, node_id), str(node.get("label") or node_id))
    return labels


def _usages_by_snapshot(
    session: Session,
    snapshot_ids: list[str],
) -> dict[str, list[NodeSnapshotUsage]]:
    if not snapshot_ids:
        return {}
    spans = (
        session.query(TraceSpanRecord)
        .filter(
            or_(
                TraceSpanRecord.node_snapshot_id.in_(snapshot_ids),
                TraceSpanRecord.runtime_input_snapshot_id.in_(snapshot_ids),
            )
        )
        .order_by(TraceSpanRecord.started_at.desc())
        .all()
    )
    traces = {
        trace.id: trace
        for trace in session.query(TraceRecord)
        .filter(TraceRecord.id.in_({span.trace_id for span in spans}))
        .all()
    }
    version_ids = {trace.agent_system_version_id for trace in traces.values()}
    versions = {
        version.id: version
        for version in session.query(AgentSystemVersionRecord)
        .filter(AgentSystemVersionRecord.id.in_(version_ids))
        .all()
    }
    system_ids = {version.agent_system_id for version in versions.values()}
    system_keys = {
        system.id: system.key
        for system in session.query(AgentSystemRecord)
        .filter(AgentSystemRecord.id.in_(system_ids))
        .all()
    }
    grouped: dict[str, list[NodeSnapshotUsage]] = defaultdict(list)
    for span in spans:
        snapshot_id = span.node_snapshot_id or span.runtime_input_snapshot_id
        if not snapshot_id:
            continue
        trace = traces.get(span.trace_id)
        role = span.snapshot_role or (
            "consumed" if trace is not None and trace.origin_type == "evaluation" else "produced"
        )
        resolution_mode = span.snapshot_resolution_mode or (
            "replayed" if role == "consumed" else "live"
        )
        metadata = dict(span.snapshot_metadata or {})
        if trace is not None:
            metadata.update(
                {
                    "trace_origin": trace.origin_type,
                    "trace_latency_ms": trace.latency_ms,
                    "model_id": trace.model_id,
                    "cost_usd": span.cost_usd,
                    "input_tokens": span.input_tokens,
                    "output_tokens": span.output_tokens,
                }
            )
        grouped[snapshot_id].append(
            NodeSnapshotUsage(
                trace_id=span.trace_id,
                agent_system_key=(
                    system_keys.get(versions[trace.agent_system_version_id].agent_system_id, "")
                    if trace is not None and trace.agent_system_version_id in versions
                    else ""
                ),
                span_id=span.id,
                node_id=span.node_id,
                role=role,
                resolution_mode=resolution_mode,
                status=span.status,
                latency_ms=span.latency_ms,
                started_at=_aware(span.started_at),
                completed_at=_aware(span.completed_at) if span.completed_at else None,
                error=span.error,
                metadata=metadata,
            )
        )
    return dict(grouped)


def _summary(
    record: NodeOutputSnapshotRecord,
    owner: AgentSystemRecord,
    labels: dict[tuple[str, str], str],
    usages: list[NodeSnapshotUsage],
) -> NodeSnapshotSummary:
    spec = system_spec(owner.key)
    return NodeSnapshotSummary(
        id=record.id,
        agent_system_id=owner.id,
        agent_system_key=owner.key,
        product_key=spec.product_key or owner.key,
        flow_key=spec.flow_key,
        flow_name=spec.flow_name,
        node_id=record.node_id,
        node_label=labels.get((owner.id, record.node_id), record.node_id),
        node_kind=record.node_kind,
        output_key=record.output_key,
        snapshot_kind=record.snapshot_kind,
        schema_version=record.schema_version,
        label=record.label,
        observed_at=_aware(record.observed_at),
        captured_at=_aware(record.captured_at),
        source=record.source,
        provider=record.provider,
        capture_mode=record.capture_mode,
        is_synthetic=record.is_synthetic,
        content_hash=record.content_hash,
        usage_count=len(usages),
        latest_usage=usages[0] if usages else None,
    )


def _revealed_content(
    session: Session,
    record: NodeOutputSnapshotRecord,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if record.storage_adapter == "portfolio_snapshot":
        domain_record = session.get(PortfolioSnapshotRecord, record.id)
        if domain_record is not None:
            detail = portfolio_snapshot_detail(domain_record)
            return deepcopy(record.provenance or {}), detail.content
    if record.storage_adapter == "runtime_input_snapshot":
        domain_record = session.get(RuntimeInputSnapshotRecord, record.id)
        if domain_record is not None:
            detail = runtime_input_snapshot_detail(domain_record)
            return detail.provenance, detail.content
    if record.is_synthetic:
        return deepcopy(record.provenance or {}), deepcopy(record.content)
    return (
        _project_generic_provenance(record.provenance or {}),
        {
            "schema_version": record.schema_version,
            "shape": _payload_shape(record.content),
        },
    )


def _project_generic_provenance(value: dict[str, Any]) -> dict[str, Any]:
    safe_keys = {
        "as_of",
        "captured_at",
        "fetched_at",
        "freshness",
        "mode",
        "provider",
        "schema_version",
        "source",
        "source_kind",
        "status",
    }
    return {key: deepcopy(item) for key, item in value.items() if key in safe_keys}


def _payload_shape(value: Any, depth: int = 0) -> dict[str, Any]:
    if depth >= 8:
        return {"type": "truncated"}
    if isinstance(value, dict):
        shapes = _unique_shapes(list(value.values())[:200], depth)
        return {"type": "object", "field_count": len(value), "field_shapes": shapes}
    if isinstance(value, list):
        return {"type": "array", "items": _unique_shapes(value[:20], depth, limit=5)}
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "boolean"}
    if isinstance(value, (int, float)):
        return {"type": "number"}
    return {"type": "string"}


def _unique_shapes(values: list[Any], depth: int, *, limit: int = 20) -> list[dict[str, Any]]:
    shapes: list[dict[str, Any]] = []
    seen: set[str] = set()
    for value in values:
        shape = _payload_shape(value, depth + 1)
        marker = json.dumps(shape, sort_keys=True)
        if marker not in seen:
            seen.add(marker)
            shapes.append(shape)
        if len(shapes) == limit:
            break
    return shapes


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
