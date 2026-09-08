import json
from collections.abc import Iterable
from statistics import mean, median
from typing import Any, Protocol

IMPORTED_DATASET_PREFIX = "imported--"


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
        suite = self._suites.get(dataset_key)
        if suite is not None:
            return suite
        if dataset_key.startswith(IMPORTED_DATASET_PREFIX):
            return ExactJsonMetricSuite()
        raise ValueError(f"No scoring suite is registered for dataset: {dataset_key}")


class ExactJsonMetricSuite:
    def score_item(self, expected: dict[str, Any], actual: dict[str, Any]) -> dict[str, float]:
        match = float(_canonical_json(expected) == _canonical_json(actual))
        return {"exact_match": match, "score": match}

    def aggregate(
        self,
        expected_items: list[dict[str, Any]],
        actual_items: list[dict[str, Any]],
        latencies: list[float],
        costs: list[float],
    ) -> dict[str, float]:
        if len(expected_items) != len(actual_items):
            raise ValueError("Expected and actual item counts must match")
        matches = [
            float(_canonical_json(expected) == _canonical_json(actual))
            for expected, actual in zip(expected_items, actual_items, strict=True)
        ]
        ordered_latencies = sorted(latencies)
        p95_index = max(0, round((len(ordered_latencies) - 1) * 0.95))
        return {
            "accuracy": round(mean(matches), 6) if matches else 0,
            "exact_match": round(mean(matches), 6) if matches else 0,
            "total_cost_usd": round(sum(costs), 8),
            "average_cost_usd": round(mean(costs), 8) if costs else 0,
            "average_latency_ms": round(mean(latencies), 3) if latencies else 0,
            "p50_latency_ms": round(median(latencies), 3) if latencies else 0,
            "p95_latency_ms": (round(ordered_latencies[p95_index], 3) if ordered_latencies else 0),
            "item_count": float(len(actual_items)),
        }


def _canonical_json(value: dict[str, Any]) -> str:
    # TODO: double check if this is safe to do
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def default_scoring_registry() -> ScoringRegistry:
    from autoeval_api.agent_systems.registry import builtin_system_plugins

    entries = [entry for plugin in builtin_system_plugins() for entry in plugin.scoring_entries()]
    return ScoringRegistry(entries)
