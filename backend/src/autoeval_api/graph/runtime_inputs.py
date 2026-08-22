from dataclasses import dataclass
from typing import Any

from autoeval_api.graph.definition import AgentGraphDefinition


@dataclass(frozen=True)
class ResolvedRuntimeInput:
    source: str
    mode: str
    schema_version: int
    capability: Any


@dataclass(frozen=True)
class RuntimeInputSnapshotBinding:
    id: str
    source_key: str
    schema_version: int
    content_hash: str
    is_synthetic: bool
    payload: dict[str, Any]
    provenance: dict[str, Any]


class RuntimeInputCapabilityRegistry:
    """Registered request-scoped dependencies used by deterministic graph nodes."""

    def __init__(self) -> None:
        self._capabilities: dict[str, Any] = {}

    def register(self, source: str, capability: Any) -> None:
        normalized = source.strip()
        if not normalized:
            raise ValueError("Runtime-input capability source cannot be empty")
        if normalized in self._capabilities:
            raise ValueError(f"Runtime-input capability already registered: {normalized}")
        self._capabilities[normalized] = capability

    def get(self, source: str) -> Any:
        capability = self._capabilities.get(source)
        if capability is None:
            raise ValueError(f"Unknown runtime-input capability: {source}")
        return capability

    def validate_definition(self, definition: AgentGraphDefinition) -> None:
        for node in definition.nodes:
            if node.runtime_input_policy is not None:
                self.get(node.runtime_input_policy.source)
