from copy import deepcopy
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from autoeval_api.models import AgentSystemRecord, NodeOutputSnapshotRecord


def ensure_node_output_snapshot(
    session: Session,
    owner: AgentSystemRecord,
    *,
    snapshot_id: str,
    source_trace_id: str | None,
    node_id: str,
    node_kind: str,
    output_key: str,
    snapshot_kind: str,
    schema_version: int,
    label: str,
    observed_at: datetime,
    captured_at: datetime,
    source: str,
    provider: str | None,
    capture_mode: str,
    is_synthetic: bool,
    content_hash: str,
    content: dict[str, Any],
    provenance: dict[str, Any],
    node_metadata: dict[str, Any],
    reveal_policy_key: str,
    storage_adapter: str,
) -> NodeOutputSnapshotRecord:
    existing = session.get(NodeOutputSnapshotRecord, snapshot_id)
    if existing is not None:
        if (
            existing.agent_system_id != owner.id
            or existing.node_id != node_id
            or existing.content_hash != content_hash
        ):
            raise ValueError(
                f"Node-output snapshot ID already exists with different content: {snapshot_id}"
            )
        return existing
    record = NodeOutputSnapshotRecord(
        id=snapshot_id,
        agent_system_id=owner.id,
        source_trace_id=source_trace_id,
        node_id=node_id,
        node_kind=node_kind,
        output_key=output_key,
        snapshot_kind=snapshot_kind,
        schema_version=schema_version,
        label=label,
        observed_at=_aware(observed_at),
        captured_at=_aware(captured_at),
        source=source,
        provider=provider,
        capture_mode=capture_mode,
        is_synthetic=is_synthetic,
        content_hash=content_hash,
        content=deepcopy(content),
        provenance=deepcopy(provenance),
        node_metadata=deepcopy(node_metadata),
        reveal_policy_key=reveal_policy_key,
        storage_adapter=storage_adapter,
    )
    session.add(record)
    return record


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
