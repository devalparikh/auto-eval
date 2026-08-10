from collections import defaultdict
from statistics import mean, median
from typing import Any

DATASET_KEY = "incident-triage-ground-truth"


class IncidentTriageMetricSuite:
    def score_item(self, expected: dict[str, Any], actual: dict[str, Any]) -> dict[str, float]:
        return score_item(expected, actual)

    def aggregate(
        self,
        expected_items: list[dict[str, Any]],
        actual_items: list[dict[str, Any]],
        latencies: list[float],
        costs: list[float],
    ) -> dict[str, float]:
        quality = classification_metrics(expected_items, actual_items)
        return aggregate_operational_metrics(quality, latencies, costs)


def classification_metrics(
    expected_items: list[dict[str, Any]], actual_items: list[dict[str, Any]]
) -> dict[str, float]:
    if len(expected_items) != len(actual_items):
        raise ValueError("Expected and actual item counts must match")
    if not expected_items:
        return {
            "accuracy": 0,
            "exact_match": 0,
            "precision_macro": 0,
            "recall_macro": 0,
            "f1_macro": 0,
            "human_review_accuracy": 0,
        }

    severity_expected = [str(item.get("severity", "")) for item in expected_items]
    severity_actual = [str(item.get("severity", "")) for item in actual_items]
    route_expected = [str(item.get("route", "")) for item in expected_items]
    route_actual = [str(item.get("route", "")) for item in actual_items]

    severity_accuracy = _accuracy(severity_expected, severity_actual)
    route_accuracy = _accuracy(route_expected, route_actual)
    precision, recall, f1 = _macro_scores(severity_expected, severity_actual)
    exact = mean(
        _comparable(expected) == _comparable(actual)
        for expected, actual in zip(expected_items, actual_items, strict=True)
    )
    human_review_accuracy = mean(
        bool(expected.get("requires_human")) == bool(actual.get("requires_human"))
        for expected, actual in zip(expected_items, actual_items, strict=True)
    )
    return {
        "accuracy": round(mean([severity_accuracy, route_accuracy]), 6),
        "severity_accuracy": round(severity_accuracy, 6),
        "route_accuracy": round(route_accuracy, 6),
        "exact_match": round(exact, 6),
        "precision_macro": round(precision, 6),
        "recall_macro": round(recall, 6),
        "f1_macro": round(f1, 6),
        "human_review_accuracy": round(human_review_accuracy, 6),
    }


def aggregate_operational_metrics(
    quality: dict[str, float], latencies: list[float], costs: list[float]
) -> dict[str, float]:
    return {
        **quality,
        "total_cost_usd": round(sum(costs), 8),
        "average_cost_usd": round(mean(costs), 8) if costs else 0,
        "average_latency_ms": round(mean(latencies), 3) if latencies else 0,
        "p50_latency_ms": round(median(latencies), 3) if latencies else 0,
        "p95_latency_ms": round(_percentile(latencies, 0.95), 3) if latencies else 0,
        "item_count": float(len(latencies)),
    }


def score_item(expected: dict[str, Any], actual: dict[str, Any]) -> dict[str, float]:
    severity = float(expected.get("severity") == actual.get("severity"))
    route = float(expected.get("route") == actual.get("route"))
    human = float(bool(expected.get("requires_human")) == bool(actual.get("requires_human")))
    return {
        "severity": severity,
        "route": route,
        "requires_human": human,
        "exact_match": float(_comparable(expected) == _comparable(actual)),
        "score": round(mean([severity, route, human]), 6),
    }


def _accuracy(expected: list[str], actual: list[str]) -> float:
    return mean(left == right for left, right in zip(expected, actual, strict=True))


def _macro_scores(expected: list[str], actual: list[str]) -> tuple[float, float, float]:
    labels = sorted(set(expected) | set(actual))
    scores: dict[str, list[float]] = defaultdict(list)
    for label in labels:
        true_positive = sum(
            expected_value == label and actual_value == label
            for expected_value, actual_value in zip(expected, actual, strict=True)
        )
        false_positive = sum(
            expected_value != label and actual_value == label
            for expected_value, actual_value in zip(expected, actual, strict=True)
        )
        false_negative = sum(
            expected_value == label and actual_value != label
            for expected_value, actual_value in zip(expected, actual, strict=True)
        )
        precision = (
            true_positive / (true_positive + false_positive)
            if true_positive + false_positive
            else 0
        )
        recall = (
            true_positive / (true_positive + false_negative)
            if true_positive + false_negative
            else 0
        )
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0
        scores["precision"].append(precision)
        scores["recall"].append(recall)
        scores["f1"].append(f1)
    return mean(scores["precision"]), mean(scores["recall"]), mean(scores["f1"])


def _comparable(item: dict[str, Any]) -> tuple[object, object, bool]:
    return item.get("severity"), item.get("route"), bool(item.get("requires_human"))


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, round((len(ordered) - 1) * percentile)))
    return ordered[index]


def scoring_entries() -> list[tuple[str, IncidentTriageMetricSuite]]:
    return [(DATASET_KEY, IncidentTriageMetricSuite())]
