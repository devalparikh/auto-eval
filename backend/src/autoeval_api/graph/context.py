from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from autoeval_api.graph.definition import RuntimeInputMode
from autoeval_api.graph.runtime_inputs import (
    ResolvedRuntimeInput,
    RuntimeInputCapabilityRegistry,
    RuntimeInputSnapshotBinding,
)


@dataclass(frozen=True)
class NodeSnapshotExecutionBinding:
    id: str | None
    role: str
    resolution_mode: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class NodeResourceExecutionBinding:
    snapshot_id: str
    resource_identity: str | None
    content: dict[str, Any]
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
    runtime_input_modes: dict[str, RuntimeInputMode] = field(default_factory=dict)
    runtime_input_snapshots: dict[str, RuntimeInputSnapshotBinding] = field(default_factory=dict)
    node_snapshots: dict[str, NodeSnapshotExecutionBinding] = field(default_factory=dict)
    node_resources: dict[str, NodeResourceExecutionBinding] = field(default_factory=dict)
    node_resource_selections: dict[str, dict[str, Any]] = field(default_factory=dict)
    capture_node_outputs: bool = False

    @property
    def runtime_input_snapshot_ids(self) -> dict[str, str]:
        return {node_id: binding.id for node_id, binding in self.runtime_input_snapshots.items()}

    @property
    def node_snapshot_ids(self) -> dict[str, str]:
        return {
            node_id: binding.id
            for node_id, binding in self.node_snapshots.items()
            if binding.id is not None
        }

    def runtime_input(self, node_id: str, source: str) -> ResolvedRuntimeInput:
        configured = self.runtime_input_modes.get(node_id)
        if configured is None:
            raise ValueError(f"Node has no runtime-input policy: {node_id}")
        if configured.source != source:
            raise ValueError(
                f"Node runtime-input source mismatch: expected {configured.source}, got {source}"
            )
        return ResolvedRuntimeInput(
            source,
            configured.mode,
            configured.schema_version,
            self.runtime_inputs.get(source),
        )

    def bind_runtime_input_snapshot(
        self,
        node_id: str,
        binding: RuntimeInputSnapshotBinding,
    ) -> None:
        self.runtime_input_snapshots[node_id] = binding
        configured = self.runtime_input_modes.get(node_id)
        locked = configured is not None and configured.mode == "locked"
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

    def bind_node_observation(
        self,
        node_id: str,
        *,
        role: str,
        resolution_mode: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        self.node_snapshots[node_id] = NodeSnapshotExecutionBinding(
            id=None,
            role=role,
            resolution_mode=resolution_mode,
            metadata=dict(metadata or {}),
        )

    def bind_node_resource(
        self,
        node_id: str,
        binding: NodeResourceExecutionBinding,
        *,
        selection_mode: str,
    ) -> None:
        self.node_resources[node_id] = binding
        self.node_resource_selections[node_id] = {
            "mode": "locked",
            "snapshot_id": binding.snapshot_id,
        }
        self.bind_node_snapshot(
            node_id,
            binding.snapshot_id,
            role="consumed",
            resolution_mode="resolved" if selection_mode == "current" else "replayed",
            metadata={
                **binding.metadata,
                "resource_identity": binding.resource_identity,
                "selected_mode": selection_mode,
            },
        )

    def node_resource(self, node_id: str) -> NodeResourceExecutionBinding:
        binding = self.node_resources.get(node_id)
        if binding is None:
            raise ValueError(f"Node resource was not resolved: {node_id}")
        return binding

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
            and binding.schema_version != configured.schema_version
        ):
            raise ValueError(
                "Runtime-input snapshot schema mismatch: "
                f"expected {configured.schema_version}, got {binding.schema_version}"
            )
        return binding
