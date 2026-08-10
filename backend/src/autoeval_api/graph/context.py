from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from autoeval_api.graph.runtime_inputs import (
    ResolvedRuntimeInput,
    RuntimeInputCapabilityRegistry,
)


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
    runtime_input_modes: dict[str, tuple[str, str]] = field(default_factory=dict)

    def runtime_input(self, node_id: str, source: str) -> ResolvedRuntimeInput:
        configured = self.runtime_input_modes.get(node_id)
        if configured is None:
            raise ValueError(f"Node has no runtime-input policy: {node_id}")
        configured_source, mode = configured
        if configured_source != source:
            raise ValueError(
                f"Node runtime-input source mismatch: expected {configured_source}, got {source}"
            )
        return ResolvedRuntimeInput(source, mode, self.runtime_inputs.get(source))
