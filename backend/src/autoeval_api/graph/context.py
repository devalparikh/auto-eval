from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from autoeval_api.graph.runtime_inputs import (
    ResolvedRuntimeInput,
    RuntimeInputCapabilityRegistry,
    RuntimeInputSnapshotBinding,
)


@dataclass(frozen=True)
class NodeSnapshotExecutionBinding:
    id: str
    role: str
    resolution_mode: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class GraphRuntimeContext:
    """Request-scoped dependencies and local resources that must not enter graph state."""

    session: Session
    agent_system_key: str
    trace_id: str | None = None
    resources: dict[str, Any] = field(default_factory=dict)
    runtime_inputs: RuntimeInputCapabilityRegistry = field(
        default_factory=RuntimeInputCapabilityRegistry
    )
    runtime_input_modes: dict[str, tuple[str, str, int]] = field(default_factory=dict)
    runtime_input_snapshots: dict[str, RuntimeInputSnapshotBinding] = field(default_factory=dict)
    runtime_input_snapshot_ids: dict[str, str] = field(default_factory=dict)
    node_snapshots: dict[str, NodeSnapshotExecutionBinding] = field(default_factory=dict)
    node_snapshot_ids: dict[str, str] = field(default_factory=dict)

    def runtime_input(self, node_id: str, source: str) -> ResolvedRuntimeInput:
        configured = self.runtime_input_modes.get(node_id)
        if configured is None:
            raise ValueError(f"Node has no runtime-input policy: {node_id}")
        configured_source, mode, schema_version = configured
        if configured_source != source:
            raise ValueError(
                f"Node runtime-input source mismatch: expected {configured_source}, got {source}"
            )
        return ResolvedRuntimeInput(
            source,
            mode,
            schema_version,
            self.runtime_inputs.get(source),
        )

    def bind_runtime_input_snapshot(
        self,
        node_id: str,
        binding: RuntimeInputSnapshotBinding,
    ) -> None:
        self.runtime_input_snapshots[node_id] = binding
        self.runtime_input_snapshot_ids[node_id] = binding.id
        configured = self.runtime_input_modes.get(node_id)
        locked = configured is not None and configured[1] == "locked"
        self.bind_node_snapshot(
            node_id,
            binding.id,
            role="consumed" if locked else "produced",
            resolution_mode="replayed" if locked else "live",
            metadata={
                "source_key": binding.source_key,
                "output_key": binding.source_key,
                "schema_version": binding.schema_version,
                "content_hash": binding.content_hash,
                "is_synthetic": binding.is_synthetic,
            },
        )

    def bind_node_snapshot(
        self,
        node_id: str,
        snapshot_id: str,
        *,
        role: str,
        resolution_mode: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        binding = NodeSnapshotExecutionBinding(
            id=snapshot_id,
            role=role,
            resolution_mode=resolution_mode,
            metadata=dict(metadata or {}),
        )
        self.node_snapshots[node_id] = binding
        self.node_snapshot_ids[node_id] = snapshot_id

    def runtime_input_snapshot(
        self,
        node_id: str,
        source_key: str,
    ) -> RuntimeInputSnapshotBinding | None:
        binding = self.runtime_input_snapshots.get(node_id)
        if binding is not None and binding.source_key != source_key:
            raise ValueError(
                f"Runtime-input snapshot source mismatch: expected {source_key}, "
                f"got {binding.source_key}"
            )
        configured = self.runtime_input_modes.get(node_id)
        if (
            binding is not None
            and configured is not None
            and binding.schema_version != configured[2]
        ):
            raise ValueError(
                "Runtime-input snapshot schema mismatch: "
                f"expected {configured[2]}, got {binding.schema_version}"
            )
        return binding
