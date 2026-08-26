from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from autoeval_api.agent_systems.registry import system_spec
from autoeval_api.graph.definition import NodeResourcePolicy, NodeResourceSelection
from autoeval_api.models import AgentSystemRecord, NodeOutputSnapshotRecord
from autoeval_api.services.portfolio_snapshots import resolve_portfolio_snapshot
from autoeval_api.services.runtime_input_snapshots import resolve_runtime_input_snapshot


@dataclass(frozen=True)
class ResolvedNodeResource:
    snapshot_id: str
    resource_identity: str | None
    content: dict[str, Any]
    metadata: dict[str, Any]


def resolve_node_resource(
    session: Session,
    *,
    consumer_system_key: str,
    policy: NodeResourcePolicy,
    selection: NodeResourceSelection,
) -> ResolvedNodeResource:
    _validate_product_scope(consumer_system_key, policy)
    producer = (
        session.query(AgentSystemRecord).filter_by(key=policy.producer_system_key).one_or_none()
    )
    if producer is None:
        raise ValueError(f"Resource producer system not found: {policy.producer_system_key}")

    query = session.query(NodeOutputSnapshotRecord).filter_by(
        agent_system_id=producer.id,
        node_id=policy.producer_node_id,
        output_key=policy.producer_output_key,
        snapshot_kind=policy.producer_snapshot_kind,
        schema_version=policy.schema_version,
    )
    if selection.mode == "current":
        record = (
            query.filter_by(resource_identity=selection.identity)
            .order_by(
                NodeOutputSnapshotRecord.observed_at.desc(),
                NodeOutputSnapshotRecord.captured_at.desc(),
                NodeOutputSnapshotRecord.id.desc(),
            )
            .first()
        )
        if record is None:
            raise ValueError(
                f"Current resource not found for {policy.resource_key}: {selection.identity}"
            )
    else:
        record = session.get(NodeOutputSnapshotRecord, selection.snapshot_id)
        if record is None:
            raise ValueError(f"Locked node resource not found: {selection.snapshot_id}")
        _validate_locked_record(record, producer, policy)

    content = _resolve_stored_content(
        session,
        record,
        owner_system_key=policy.producer_system_key,
    )
    return ResolvedNodeResource(
        snapshot_id=record.id,
        resource_identity=record.resource_identity,
        content=content,
        metadata={
            "product_key": policy.product_key,
            "resource_key": policy.resource_key,
            "producer_system_key": policy.producer_system_key,
            "producer_node_id": policy.producer_node_id,
            "producer_output_key": policy.producer_output_key,
            "producer_snapshot_kind": policy.producer_snapshot_kind,
            "output_key": policy.producer_output_key,
            "schema_version": policy.schema_version,
            "content_hash": record.content_hash,
            "is_synthetic": record.is_synthetic,
            "source_trace_id": record.source_trace_id,
            "observed_at": record.observed_at.isoformat(),
            "captured_at": record.captured_at.isoformat(),
        },
    )


def serialize_node_resource_selections(
    values: dict[str, NodeResourceSelection | dict[str, Any]] | None,
) -> dict[str, dict[str, Any]]:
    return {
        node_id: NodeResourceSelection.model_validate(value).model_dump(exclude_none=True)
        for node_id, value in (values or {}).items()
    }


def validate_dataset_node_resource_selections(
    session: Session,
    *,
    consumer_system_id: str,
    values: dict[str, NodeResourceSelection | dict[str, Any]] | None,
) -> dict[str, dict[str, Any]]:
    normalized = serialize_node_resource_selections(values)
    consumer = session.get(AgentSystemRecord, consumer_system_id)
    if consumer is None:
        raise ValueError("Node resource consumer system not found")
    consumer_product = system_spec(consumer.key).product_key or consumer.key
    for node_id, value in normalized.items():
        selection = NodeResourceSelection.model_validate(value)
        if selection.mode != "locked":
            raise ValueError(f"Dataset node resource must lock an exact snapshot: {node_id}")
        record = session.get(NodeOutputSnapshotRecord, selection.snapshot_id)
        if record is None:
            raise ValueError(f"Locked node resource not found: {selection.snapshot_id}")
        producer = session.get(AgentSystemRecord, record.agent_system_id)
        producer_product = (
            system_spec(producer.key).product_key if producer is not None else None
        ) or (producer.key if producer is not None else None)
        if producer_product != consumer_product:
            raise ValueError("Dataset node resource belongs to another product")
        _validate_snapshot_integrity(session, record, producer)
    return normalized


def _validate_product_scope(consumer_system_key: str, policy: NodeResourcePolicy) -> None:
    consumer_product = system_spec(consumer_system_key).product_key or consumer_system_key
    producer_product = (
        system_spec(policy.producer_system_key).product_key or policy.producer_system_key
    )
    if consumer_product != policy.product_key or producer_product != policy.product_key:
        raise ValueError("Node resource producer and consumer must belong to the policy product")


def _validate_locked_record(
    record: NodeOutputSnapshotRecord,
    producer: AgentSystemRecord,
    policy: NodeResourcePolicy,
) -> None:
    if record.agent_system_id != producer.id:
        raise ValueError("Locked node resource belongs to another producer system")
    if record.node_id != policy.producer_node_id:
        raise ValueError("Locked node resource producer node does not match graph policy")
    if record.output_key != policy.producer_output_key:
        raise ValueError("Locked node resource output key does not match graph policy")
    if record.snapshot_kind != policy.producer_snapshot_kind:
        raise ValueError("Locked node resource snapshot kind does not match graph policy")
    if record.schema_version != policy.schema_version:
        raise ValueError("Locked node resource schema version does not match graph policy")


def _validate_snapshot_integrity(
    session: Session,
    record: NodeOutputSnapshotRecord,
    producer: AgentSystemRecord | None,
) -> None:
    if producer is None:
        raise ValueError("Node resource producer system not found")
    _resolve_stored_content(session, record, owner_system_key=producer.key)


def _resolve_stored_content(
    session: Session,
    record: NodeOutputSnapshotRecord,
    *,
    owner_system_key: str,
) -> dict[str, Any]:
    if record.storage_adapter == "portfolio_snapshot":
        domain_record, document = resolve_portfolio_snapshot(
            session,
            record.id,
            owner_system_key=owner_system_key,
        )
        expected_document = {
            "id": domain_record.id,
            "content_hash": domain_record.content_hash,
            **record.content,
        }
        if domain_record.content_hash != record.content_hash or document != expected_document:
            raise ValueError("Portfolio node resource does not match its catalog record")
        return document
    if record.storage_adapter == "runtime_input_snapshot":
        domain_record, payload = resolve_runtime_input_snapshot(
            session,
            record.id,
            owner_system_key=owner_system_key,
            source_key=record.output_key,
            node_id=record.node_id,
            schema_version=record.schema_version,
        )
        if domain_record.content_hash != record.content_hash or payload != record.content:
            raise ValueError("Runtime-input node resource does not match its catalog record")
        return payload
    if not isinstance(record.content, dict):
        raise ValueError("Node resource content must be an object")
    return deepcopy(record.content)
