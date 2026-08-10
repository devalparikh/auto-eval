from typing import Any

import pytest

from autoeval_api.graph.registry import NodeHandlerRegistry
from autoeval_api.inference.base import InferenceRequest, InferenceResponse, ModelDescriptor
from autoeval_api.inference.registry import InferenceProviderRegistry
from autoeval_api.services.scoring import ScoringRegistry


class FakeProvider:
    provider_id = "fake"

    def models(self) -> list[ModelDescriptor]:
        return [ModelDescriptor("fake/model", "fake", "Fake", ("text",))]

    async def complete(self, request: InferenceRequest) -> InferenceResponse:
        return InferenceResponse(output=request.state, raw_text="{}")


class FakeMetricSuite:
    def score_item(self, expected: dict[str, Any], actual: dict[str, Any]) -> dict[str, float]:
        return {"match": float(expected == actual)}

    def aggregate(
        self,
        expected_items: list[dict[str, Any]],
        actual_items: list[dict[str, Any]],
        latencies: list[float],
        costs: list[float],
    ) -> dict[str, float]:
        return {"count": float(len(actual_items))}


def test_provider_registry_accepts_registered_provider() -> None:
    registry = InferenceProviderRegistry()
    registry.register(FakeProvider())

    assert registry.get_for_model("fake/model").provider_id == "fake"
    with pytest.raises(ValueError, match="already registered"):
        registry.register(FakeProvider())


def test_node_registry_accepts_registered_handlers() -> None:
    registry = NodeHandlerRegistry()
    registry.register_deterministic("copy_input", lambda state: {"copy": state["input"]})

    assert registry.deterministic("copy_input")({"input": {"value": 1}}) == {"copy": {"value": 1}}
    with pytest.raises(ValueError, match="already registered"):
        registry.register_deterministic("copy_input", lambda state: state)


def test_node_registry_scopes_identical_handler_names_by_system() -> None:
    registry = NodeHandlerRegistry()
    registry.scoped("one").register_deterministic("normalize", lambda _state: {"one": True})
    registry.scoped("two").register_deterministic("normalize", lambda _state: {"two": True})

    assert registry.deterministic("normalize", "one")({}) == {"one": True}
    assert registry.deterministic("normalize", "two")({}) == {"two": True}


def test_scoring_registry_selects_suite_by_dataset_key() -> None:
    suite = FakeMetricSuite()
    registry = ScoringRegistry([("example-dataset", suite)])

    assert registry.for_dataset("example-dataset") is suite
    with pytest.raises(ValueError, match="No scoring suite"):
        registry.for_dataset("unknown")
