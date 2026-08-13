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
    resource_identity: str | None,
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
        immutable_matches = (
            existing.agent_system_id == owner.id
            and existing.source_trace_id == source_trace_id
            and existing.node_id == node_id
            and existing.node_kind == node_kind
            and existing.output_key == output_key
            and existing.resource_identity == resource_identity
            and existing.snapshot_kind == snapshot_kind
            and existing.schema_version == schema_version
            and existing.label == label
            and _aware(existing.observed_at) == _aware(observed_at)
            and _aware(existing.captured_at) == _aware(captured_at)
            and existing.source == source
            and existing.provider == provider
            and existing.capture_mode == capture_mode
            and existing.is_synthetic is is_synthetic
            and existing.content_hash == content_hash
            and existing.content == content
            and existing.provenance == provenance
            and existing.node_metadata == node_metadata
            and existing.reveal_policy_key == reveal_policy_key
            and existing.storage_adapter == storage_adapter
        )
        if not immutable_matches:
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
        resource_identity=resource_identity,
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
