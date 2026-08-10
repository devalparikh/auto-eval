from statistics import mean
from typing import Any

from autoeval_api.agent_systems.incident_triage.scoring import aggregate_operational_metrics

DATASET_KEY = "portfolio-analysis-ground-truth"
EXPECTED_FIELDS = (
    "analysis_ready",
    "top_holding_symbol",
    "concentration_flag_count",
    "scenario_count",
)


class PortfolioAnalysisMetricSuite:
    def score_item(self, expected: dict[str, Any], actual: dict[str, Any]) -> dict[str, float]:
        normalized = _actual_projection(actual)
        scores = {
            field: float(expected.get(field) == normalized.get(field))
            for field in EXPECTED_FIELDS
            if field in expected
        }
        score = mean(scores.values()) if scores else 0
        return {**scores, "score": round(score, 6), "exact_match": float(score == 1)}

    def aggregate(
        self,
        expected_items: list[dict[str, Any]],
        actual_items: list[dict[str, Any]],
        latencies: list[float],
        costs: list[float],
    ) -> dict[str, float]:
        item_scores = [
            self.score_item(expected, actual)
            for expected, actual in zip(expected_items, actual_items, strict=True)
        ]
        accuracy = mean(item["score"] for item in item_scores) if item_scores else 0
        exact = mean(item["exact_match"] for item in item_scores) if item_scores else 0
        return aggregate_operational_metrics(
            {
                "accuracy": round(accuracy, 6),
                "exact_match": round(exact, 6),
                "precision_macro": round(accuracy, 6),
                "recall_macro": round(accuracy, 6),
                "f1_macro": round(accuracy, 6),
            },
            latencies,
            costs,
        )


def _actual_projection(actual: dict[str, Any]) -> dict[str, Any]:
    metrics = actual.get("metrics", {}) if isinstance(actual.get("metrics"), dict) else {}
    return {
        "analysis_ready": bool(actual.get("analysis_ready")),
        "top_holding_symbol": metrics.get("top_holding_symbol"),
        "concentration_flag_count": len(metrics.get("concentration_flags", [])),
        "scenario_count": len(metrics.get("scenarios", [])),
    }


def scoring_entries() -> list[tuple[str, PortfolioAnalysisMetricSuite]]:
    return [(DATASET_KEY, PortfolioAnalysisMetricSuite())]
