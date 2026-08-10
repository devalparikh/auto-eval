from collections.abc import Callable
from typing import Any

from autoeval_api.inference.base import InferenceResponse

DeterministicHandler = Callable[[dict[str, Any]], dict[str, Any]]
LlmOutputHandler = Callable[[dict[str, Any], InferenceResponse], dict[str, Any]]


class NodeHandlerRegistry:
    def __init__(self) -> None:
        self._deterministic: dict[str, DeterministicHandler] = {}
        self._llm_output: dict[str, LlmOutputHandler] = {}

    def register_deterministic(self, name: str, handler: DeterministicHandler) -> None:
        self._register(self._deterministic, name, handler)

    def register_llm_output(self, name: str, handler: LlmOutputHandler) -> None:
        self._register(self._llm_output, name, handler)

    def deterministic(self, name: str) -> DeterministicHandler:
        try:
            return self._deterministic[name]
        except KeyError as error:
            raise ValueError(f"Unknown deterministic node handler: {name}") from error

    def llm_output(self, name: str) -> LlmOutputHandler:
        try:
            return self._llm_output[name]
        except KeyError as error:
            raise ValueError(f"Unknown LLM node handler: {name}") from error

    def validate_definition(self, definition: dict[str, Any]) -> None:
        for node in definition["nodes"]:
            if node["kind"] == "deterministic":
                self.deterministic(node["handler"])
            else:
                self.llm_output(node["handler"])

    @staticmethod
    def _register(registry: dict[str, Callable], name: str, handler: Callable) -> None:
        if name in registry:
            raise ValueError(f"Node handler is already registered: {name}")
        registry[name] = handler


def default_node_handler_registry() -> NodeHandlerRegistry:
    from autoeval_api.agent_systems.incident_triage.handlers import register_handlers

    registry = NodeHandlerRegistry()
    register_handlers(registry)
    return registry
