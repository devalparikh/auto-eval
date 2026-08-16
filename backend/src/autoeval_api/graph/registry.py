from collections.abc import Awaitable, Callable
from typing import Any

from autoeval_api.graph.context import GraphRuntimeContext
from autoeval_api.graph.definition import AgentGraphDefinition
from autoeval_api.inference.base import InferenceResponse

DeterministicResult = dict[str, Any] | Awaitable[dict[str, Any]]
DeterministicHandler = Callable[[dict[str, Any]], DeterministicResult]
ContextualDeterministicHandler = Callable[
    [dict[str, Any], GraphRuntimeContext], DeterministicResult
]
LlmOutputHandler = Callable[[dict[str, Any], InferenceResponse], dict[str, Any]]


class NodeHandlerRegistry:
    def __init__(self) -> None:
        self._deterministic: dict[tuple[str | None, str], ContextualDeterministicHandler] = {}
        self._llm_output: dict[tuple[str | None, str], LlmOutputHandler] = {}

    def register_deterministic(
        self, name: str, handler: DeterministicHandler, system_key: str | None = None
    ) -> None:
        def without_context(
            state: dict[str, Any], _context: GraphRuntimeContext | None = None
        ) -> DeterministicResult:
            return handler(state)

        self._register(self._deterministic, system_key, name, without_context)

    def register_contextual_deterministic(
        self,
        name: str,
        handler: ContextualDeterministicHandler,
        system_key: str | None = None,
    ) -> None:
        self._register(self._deterministic, system_key, name, handler)

    def register_llm_output(
        self, name: str, handler: LlmOutputHandler, system_key: str | None = None
    ) -> None:
        self._register(self._llm_output, system_key, name, handler)

    def deterministic(
        self, name: str, system_key: str | None = None
    ) -> ContextualDeterministicHandler:
        handler = self._deterministic.get((system_key, name)) or self._deterministic.get(
            (None, name)
        )
        if handler is None:
            raise ValueError(f"Unknown deterministic node handler: {system_key or '*'}:{name}")
        return handler

    def llm_output(self, name: str, system_key: str | None = None) -> LlmOutputHandler:
        handler = self._llm_output.get((system_key, name)) or self._llm_output.get((None, name))
        if handler is None:
            raise ValueError(f"Unknown LLM node handler: {system_key or '*'}:{name}")
        return handler

    def validate_definition(
        self, definition: AgentGraphDefinition, system_key: str | None = None
    ) -> None:
        for node in definition.nodes:
            if node.kind == "deterministic":
                self.deterministic(node.handler, system_key)
            else:
                self.llm_output(node.handler, system_key)

    def scoped(self, system_key: str) -> "ScopedNodeHandlerRegistry":
        return ScopedNodeHandlerRegistry(self, system_key)

    @staticmethod
    def _register(
        registry: dict[tuple[str | None, str], Callable],
        system_key: str | None,
        name: str,
        handler: Callable,
    ) -> None:
        key = (system_key, name)
        if key in registry:
            raise ValueError(f"Node handler is already registered: {system_key or '*'}:{name}")
        registry[key] = handler


class ScopedNodeHandlerRegistry:
    def __init__(self, registry: NodeHandlerRegistry, system_key: str) -> None:
        self.registry = registry
        self.system_key = system_key

    def register_deterministic(self, name: str, handler: DeterministicHandler) -> None:
        self.registry.register_deterministic(name, handler, self.system_key)

    def register_contextual_deterministic(
        self, name: str, handler: ContextualDeterministicHandler
    ) -> None:
        self.registry.register_contextual_deterministic(name, handler, self.system_key)

    def register_llm_output(self, name: str, handler: LlmOutputHandler) -> None:
        self.registry.register_llm_output(name, handler, self.system_key)


def default_node_handler_registry() -> NodeHandlerRegistry:
    from autoeval_api.agent_systems.registry import builtin_system_plugins

    registry = NodeHandlerRegistry()
    for plugin in builtin_system_plugins():
        plugin.register_handlers(registry)
    return registry
