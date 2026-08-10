from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ResolvedRuntimeInput:
    source: str
    mode: str
    capability: Any


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

    def validate_definition(self, definition: dict[str, Any]) -> None:
        for node in definition.get("nodes", []):
            policy = node.get("runtime_input_policy")
            if isinstance(policy, dict):
                self.get(str(policy.get("source", "")))
