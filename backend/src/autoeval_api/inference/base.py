from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True)
class InferenceRequest:
    model_id: str
    system_prompt: str
    task: str
    state: dict[str, Any]
    response_schema: dict[str, Any] | None = None
    agent_system_key: str | None = None
    modalities: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class InferenceResponse:
    output: dict[str, Any]
    raw_text: str
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ModelDescriptor:
    id: str
    provider: str
    label: str
    supports: tuple[str, ...]
    available: bool = True
    notice: str | None = None
    blocked_agent_system_keys: tuple[str, ...] = ()


class InferenceProvider(Protocol):
    provider_id: str

    def models(self) -> list[ModelDescriptor]: ...

    async def complete(self, request: InferenceRequest) -> InferenceResponse: ...
