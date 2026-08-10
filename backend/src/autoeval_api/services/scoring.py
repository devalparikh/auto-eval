from collections.abc import Iterable
from typing import Any, Protocol


class MetricSuite(Protocol):
    def score_item(self, expected: dict[str, Any], actual: dict[str, Any]) -> dict[str, float]: ...

    def aggregate(
        self,
        expected_items: list[dict[str, Any]],
        actual_items: list[dict[str, Any]],
        latencies: list[float],
        costs: list[float],
    ) -> dict[str, float]: ...


class ScoringRegistry:
    def __init__(self, entries: Iterable[tuple[str, MetricSuite]] = ()) -> None:
        self._suites: dict[str, MetricSuite] = {}
        for dataset_key, suite in entries:
            self.register(dataset_key, suite)

    def register(self, dataset_key: str, suite: MetricSuite) -> None:
        if dataset_key in self._suites:
            raise ValueError(f"Scoring suite is already registered: {dataset_key}")
        self._suites[dataset_key] = suite

    def for_dataset(self, dataset_key: str) -> MetricSuite:
        try:
            return self._suites[dataset_key]
        except KeyError as error:
            raise ValueError(
                f"No scoring suite is registered for dataset: {dataset_key}"
            ) from error


def default_scoring_registry() -> ScoringRegistry:
    from autoeval_api.agent_systems.registry import builtin_system_plugins

    entries = [entry for plugin in builtin_system_plugins() for entry in plugin.scoring_entries()]
    return ScoringRegistry(entries)
