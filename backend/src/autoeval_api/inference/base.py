import asyncio
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractContextManager, ExitStack, asynccontextmanager
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

    # The judge authorizes the actual HTTP body write against retained evidence.
    body_guard: Callable[[], AbstractContextManager[float]] | None = field(
        default=None, repr=False, compare=False
    )

    @asynccontextmanager
    async def http_body(self, data: bytes) -> AsyncIterator[bytes | AsyncIterator[bytes]]:
        if self.body_guard is None:
            yield data
            return

        # Authorize before opening the HTTP request. Keep the transaction through
        # the write, then release it while the provider computes its response.
        with ExitStack() as lock:
            remaining = lock.enter_context(self.body_guard())
            deadline = asyncio.get_running_loop().time() + remaining
            async with asyncio.timeout_at(deadline) as write_timeout:

                async def stream():
                    if asyncio.get_running_loop().time() >= deadline:
                        raise TimeoutError("Authorization expired before body write")
                    yield data
                    lock.close()
                    write_timeout.reschedule(None)

                yield stream()


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
