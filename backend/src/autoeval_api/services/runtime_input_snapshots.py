from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from autoeval_api.graph.runtime_inputs import RuntimeInputSnapshotBinding
from autoeval_api.models import (
    AgentSystemRecord,
    AgentSystemVersionRecord,
    RuntimeInputSnapshotRecord,
    TraceRecord,
)
from autoeval_api.schemas import RuntimeInputSnapshotDetail, RuntimeInputSnapshotSummary
from autoeval_api.services.snapshot_catalog import ensure_node_output_snapshot


def create_runtime_input_snapshot(
    session: Session,
    owner: AgentSystemRecord,
    *,
    source_trace_id: str | None,
    node_id: str,
    source_key: str,
    schema_version: int,
    observed_at: datetime,
    fetched_at: datetime,
    provider: str,
    source_kind: str,
    is_synthetic: bool,
    payload: dict[str, Any],
    provenance: dict[str, Any],
    label: str | None = None,
) -> RuntimeInputSnapshotRecord:
    normalized_node_id = _required_text(node_id, "node_id", 160)
    normalized_source_key = _required_text(source_key, "source_key", 120)
    normalized_provider = _required_text(provider, "provider", 120)
    normalized_source_kind = _required_text(source_kind, "source_kind", 40)
    if schema_version < 1:
        raise ValueError("Runtime-input snapshot schema_version must be at least 1")
    if source_trace_id is not None:
        _validate_trace_owner(session, source_trace_id, owner.id)
    normalized_observed_at = _aware_utc(observed_at)
    normalized_fetched_at = _aware_utc(fetched_at)
    content_hash = runtime_input_snapshot_content_hash(
        node_id=normalized_node_id,
        source_key=normalized_source_key,
        schema_version=schema_version,
        observed_at=normalized_observed_at,
        fetched_at=normalized_fetched_at,
        provider=normalized_provider,
        source_kind=normalized_source_kind,
        is_synthetic=is_synthetic,
        payload=payload,
        provenance=provenance,
    )
    duplicate = (
        session.query(RuntimeInputSnapshotRecord)
        .filter_by(agent_system_id=owner.id, content_hash=content_hash)
        .first()
    )
    if duplicate is not None:
        _catalog_runtime_input_snapshot(session, owner, duplicate)
        session.commit()
        return duplicate
    if source_trace_id is not None:
        existing_binding = (
            session.query(RuntimeInputSnapshotRecord)
            .filter_by(
                source_trace_id=source_trace_id,
                node_id=normalized_node_id,
                source_key=normalized_source_key,
            )
            .first()
        )
        if existing_binding is not None:
            raise ValueError(
                "Trace node already captured a different runtime-input snapshot: "
                f"{existing_binding.id}"
            )
    record = RuntimeInputSnapshotRecord(
        agent_system_id=owner.id,
        source_trace_id=source_trace_id,
        node_id=normalized_node_id,
        source_key=normalized_source_key,
        schema_version=schema_version,
        label=(label or f"{normalized_source_key} observed {normalized_observed_at.isoformat()}")[
            :200
        ],
        observed_at=normalized_observed_at,
        fetched_at=normalized_fetched_at,
        provider=normalized_provider,
        source_kind=normalized_source_kind,
        is_synthetic=is_synthetic,
        content_hash=content_hash,
        payload=deepcopy(payload),
        provenance=deepcopy(provenance),
    )
    session.add(record)
    try:
        session.flush()
        _catalog_runtime_input_snapshot(session, owner, record)
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise ValueError("A concurrent request created this runtime-input snapshot") from error
    session.refresh(record)
    return record


def resolve_runtime_input_snapshot(
    session: Session,
    snapshot_id: str,
    *,
    owner_system_key: str,
    source_key: str,
    node_id: str,
    schema_version: int,
) -> tuple[RuntimeInputSnapshotRecord, dict[str, Any]]:
    record = session.get(RuntimeInputSnapshotRecord, snapshot_id)
    if record is None:
        raise ValueError(f"Runtime-input snapshot not found: {snapshot_id}")
    owner = session.get(AgentSystemRecord, record.agent_system_id)
    if owner is None or owner.key != owner_system_key:
        raise ValueError("Runtime-input snapshot belongs to another agent system")
    if record.source_key != source_key:
        raise ValueError("Runtime-input snapshot source_key does not match the graph policy")
    if record.node_id != node_id:
        raise ValueError("Runtime-input snapshot node_id does not match the graph policy")
    if record.schema_version != schema_version:
        raise ValueError("Runtime-input snapshot schema_version does not match the graph policy")
    _validate_content_hash(record)
    return record, deepcopy(record.payload)


def list_runtime_input_snapshots(
    session: Session,
    agent_system_id: str,
    *,
    source_key: str | None = None,
    node_id: str | None = None,
    synthetic_only: bool = False,
    limit: int = 100,
) -> list[RuntimeInputSnapshotRecord]:
    query = session.query(RuntimeInputSnapshotRecord).filter_by(agent_system_id=agent_system_id)
    if source_key:
        query = query.filter_by(source_key=source_key)
    if node_id:
        query = query.filter_by(node_id=node_id)
    if synthetic_only:
        query = query.filter_by(is_synthetic=True)
    return query.order_by(RuntimeInputSnapshotRecord.created_at.desc()).limit(limit).all()


def runtime_input_snapshot_binding(
    record: RuntimeInputSnapshotRecord,
) -> RuntimeInputSnapshotBinding:
    _validate_content_hash(record)
    return RuntimeInputSnapshotBinding(
        id=record.id,
        source_key=record.source_key,
        schema_version=record.schema_version,
        content_hash=record.content_hash,
        is_synthetic=record.is_synthetic,
        payload=deepcopy(record.payload),
        provenance=deepcopy(record.provenance),
    )


def validate_runtime_input_snapshot_map(
    session: Session,
    agent_system_id: str,
    snapshot_ids: dict[str, str] | None,
) -> dict[str, RuntimeInputSnapshotRecord]:
    records: dict[str, RuntimeInputSnapshotRecord] = {}
    for node_id, snapshot_id in (snapshot_ids or {}).items():
        record = session.get(RuntimeInputSnapshotRecord, snapshot_id)
        if record is None:
            raise ValueError(f"Runtime-input snapshot not found: {snapshot_id}")
        if record.agent_system_id != agent_system_id:
            raise ValueError("Runtime-input snapshot belongs to another agent system")
        if record.node_id != node_id:
            raise ValueError(
                f"Runtime-input snapshot {snapshot_id} belongs to node {record.node_id}, "
                f"not {node_id}"
            )
        _validate_content_hash(record)
        records[node_id] = record
    return records


def runtime_input_snapshot_summary(
    record: RuntimeInputSnapshotRecord,
) -> RuntimeInputSnapshotSummary:
    return RuntimeInputSnapshotSummary.model_validate(record, from_attributes=True)


def runtime_input_snapshot_detail(
    record: RuntimeInputSnapshotRecord,
) -> RuntimeInputSnapshotDetail:
    _validate_content_hash(record)
    content = (
        deepcopy(record.payload)
        if record.is_synthetic
        else {
            "schema_version": record.schema_version,
            "shape": _payload_shape(record.payload),
        }
    )
    return RuntimeInputSnapshotDetail(
        **runtime_input_snapshot_summary(record).model_dump(),
        provenance=(
            deepcopy(record.provenance)
            if record.is_synthetic
            else _project_real_provenance(record.provenance)
        ),
        content_available=True,
        content=content,
    )


def runtime_input_snapshot_content_hash(
    *,
    node_id: str,
    source_key: str,
    schema_version: int,
    observed_at: datetime,
    fetched_at: datetime,
    provider: str,
    source_kind: str,
    is_synthetic: bool,
    payload: dict[str, Any],
    provenance: dict[str, Any],
) -> str:
    envelope = {
        "node_id": node_id,
        "source_key": source_key,
        "schema_version": schema_version,
        "observed_at": _aware_utc(observed_at).isoformat(),
        "fetched_at": _aware_utc(fetched_at).isoformat(),
        "provider": provider,
        "source_kind": source_kind,
        "is_synthetic": is_synthetic,
        "payload": payload,
        "provenance": provenance,
    }
    canonical = json.dumps(envelope, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


def _validate_content_hash(record: RuntimeInputSnapshotRecord) -> None:
    actual = runtime_input_snapshot_content_hash(
        node_id=record.node_id,
        source_key=record.source_key,
        schema_version=record.schema_version,
        observed_at=record.observed_at,
        fetched_at=record.fetched_at,
        provider=record.provider,
        source_kind=record.source_kind,
        is_synthetic=record.is_synthetic,
        payload=record.payload,
        provenance=record.provenance,
    )
    if actual != record.content_hash:
        raise ValueError("Stored runtime-input snapshot failed content-hash validation")


def _catalog_runtime_input_snapshot(
    session: Session,
    owner: AgentSystemRecord,
    record: RuntimeInputSnapshotRecord,
) -> None:
    node_metadata = {
        key: deepcopy(record.provenance[key])
        for key in ("status", "contract_count", "freshness", "greeks", "error_code")
        if key in record.provenance
    }
    node_metadata["output_contract"] = record.source_key
    ensure_node_output_snapshot(
        session,
        owner,
        snapshot_id=record.id,
        source_trace_id=record.source_trace_id,
        node_id=record.node_id,
        node_kind="external_input",
        output_key=record.source_key,
        snapshot_kind="external_observation",
        schema_version=record.schema_version,
        label=record.label,
        observed_at=record.observed_at,
        captured_at=record.fetched_at,
        source=record.source_key,
        provider=record.provider,
        capture_mode=(
            "seeded"
            if record.source_trace_id is None or record.source_kind == "seed_fixture"
            else "live"
        ),
        is_synthetic=record.is_synthetic,
        content_hash=record.content_hash,
        content=record.payload,
        provenance=record.provenance,
        node_metadata=node_metadata,
        reveal_policy_key="external_observation",
        storage_adapter="runtime_input_snapshot",
    )


def _validate_trace_owner(session: Session, trace_id: str, owner_id: str) -> None:
    trace = session.get(TraceRecord, trace_id)
    graph = (
        session.get(AgentSystemVersionRecord, trace.agent_system_version_id)
        if trace is not None
        else None
    )
    if graph is None:
        raise ValueError("Runtime-input snapshot source trace was not found")
    if graph.agent_system_id != owner_id:
        raise ValueError("Runtime-input snapshot source trace belongs to another agent system")


def _required_text(value: str, field: str, max_length: int) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"Runtime-input snapshot {field} cannot be empty")
    if len(normalized) > max_length:
        raise ValueError(f"Runtime-input snapshot {field} exceeds {max_length} characters")
    return normalized


def _aware_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _payload_shape(value: Any, depth: int = 0) -> dict[str, Any]:
    if depth >= 8:
        return {"type": "truncated"}
    if isinstance(value, dict):
        field_shapes: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in list(value.values())[:200]:
            shape = _payload_shape(item, depth + 1)
            marker = json.dumps(shape, sort_keys=True)
            if marker not in seen:
                seen.add(marker)
                field_shapes.append(shape)
            if len(field_shapes) == 20:
                break
        return {
            "type": "object",
            "field_count": len(value),
            "field_shapes": field_shapes,
        }
    if isinstance(value, list):
        item_shapes: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in value[:20]:
            shape = _payload_shape(item, depth + 1)
            marker = json.dumps(shape, sort_keys=True)
            if marker not in seen:
                seen.add(marker)
                item_shapes.append(shape)
            if len(item_shapes) == 5:
                break
        return {"type": "array", "items": item_shapes}
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "boolean"}
    if isinstance(value, (int, float)):
        return {"type": "number"}
    return {"type": "string"}


def _project_real_provenance(value: dict[str, Any]) -> dict[str, Any]:
    scalar_keys = (
        "schema_version",
        "provider",
        "source",
        "source_kind",
        "mode",
        "status",
        "as_of",
        "observed_at",
        "fetched_at",
        "contract_count",
        "quote_delay_minutes",
        "error_code",
    )
    projected = {key: deepcopy(value[key]) for key in scalar_keys if key in value}
    freshness = value.get("freshness")
    if isinstance(freshness, dict):
        projected["freshness"] = {
            key: deepcopy(freshness[key])
            for key in (
                "status",
                "age_seconds",
                "max_age_seconds",
                "quote_delay_minutes",
            )
            if key in freshness
        }
    greeks = value.get("greeks")
    if isinstance(greeks, dict):
        projected["greeks"] = {
            key: deepcopy(greeks[key])
            for key in ("status", "as_of", "age_seconds")
            if key in greeks
        }
    return projected
