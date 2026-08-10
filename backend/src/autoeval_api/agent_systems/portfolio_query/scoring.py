from statistics import mean
from typing import Any

from autoeval_api.agent_systems.incident_triage.scoring import aggregate_operational_metrics

DATASET_KEY = "portfolio-query-ground-truth"

REQUIRED_CANDIDATE_CHECKS = {
    "call_option",
    "valid_expiry",
    "standard_contract_multiplier",
    "covered_calls_allowed",
    "assignment_acceptable",
    "not_do_not_touch",
    "fully_covered",
    "dte_in_range",
    "delta_in_range",
    "liquid_open_interest",
    "spread_in_range",
    "strike_upside_in_range",
    "exit_floor_met",
    "event_policy_met",
    "valid_bid",
}


class PortfolioQueryMetricSuite:
    def score_item(self, expected: dict[str, Any], actual: dict[str, Any]) -> dict[str, float]:
        projection = _actual_projection(actual)
        comparisons = {
            key: float(projection.get(key) == expected.get(key))
            for key in ("status", "candidate_ids", "market_data_fresh")
            if key in expected
        }
        accuracy = mean(comparisons.values()) if comparisons else 0
        safe = float(_safe(expected, actual))
        weighted = accuracy * safe
        return {
            **comparisons,
            "safety": safe,
            "score": round(weighted, 6),
            "exact_match": float(weighted == 1),
        }

    def aggregate(
        self,
        expected_items: list[dict[str, Any]],
        actual_items: list[dict[str, Any]],
        latencies: list[float],
        costs: list[float],
    ) -> dict[str, float]:
        items = [
            self.score_item(expected, actual)
            for expected, actual in zip(expected_items, actual_items, strict=True)
        ]
        weighted = mean(item["score"] for item in items) if items else 0
        exact = mean(item["exact_match"] for item in items) if items else 0
        safety = mean(item["safety"] for item in items) if items else 0
        return aggregate_operational_metrics(
            {
                "accuracy": round(weighted, 6),
                "safety_weighted_accuracy": round(weighted, 6),
                "safety_compliance": round(safety, 6),
                "exact_match": round(exact, 6),
                "precision_macro": round(weighted, 6),
                "recall_macro": round(weighted, 6),
                "f1_macro": round(weighted, 6),
            },
            latencies,
            costs,
        )


def scoring_entries() -> list[tuple[str, PortfolioQueryMetricSuite]]:
    return [(DATASET_KEY, PortfolioQueryMetricSuite())]


def _actual_projection(actual: dict[str, Any]) -> dict[str, Any]:
    covered_call = (
        actual.get("covered_call", {}) if isinstance(actual.get("covered_call"), dict) else {}
    )
    safety = actual.get("safety", {}) if isinstance(actual.get("safety"), dict) else {}
    return {
        "status": covered_call.get("status"),
        "candidate_ids": [
            item.get("contract_id")
            for item in covered_call.get("candidates", [])
            if isinstance(item, dict)
        ],
        "market_data_fresh": bool(safety.get("market_data_fresh")),
    }


def _safe(expected: dict[str, Any], actual: dict[str, Any]) -> bool:
    covered_call = (
        actual.get("covered_call", {}) if isinstance(actual.get("covered_call"), dict) else {}
    )
    candidates = covered_call.get("candidates", [])
    status = covered_call.get("status")
    if not isinstance(candidates, list):
        return False
    if not candidates:
        return status == expected.get("status") and status in {
            "blocked",
            "needs_market_data",
            "missing_context",
            "ready",
        }

    safety = actual.get("safety", {}) if isinstance(actual.get("safety"), dict) else {}
    if status != "candidates" or not safety.get("market_data_fresh"):
        return False
    if not safety.get("fully_covered") or not safety.get("assignment_acknowledgement_required"):
        return False

    for expected_rank, candidate in enumerate(candidates, start=1):
        if not isinstance(candidate, dict):
            return False
        if candidate.get("option_type") != "call" or candidate.get("rank") != expected_rank:
            return False
        if not _valid_candidate_numbers(candidate):
            return False
        checks = candidate.get("policy_checks", [])
        if not isinstance(checks, list):
            return False
        by_key = {
            str(item.get("key")): item.get("passed") is True
            for item in checks
            if isinstance(item, dict)
        }
        if not by_key.keys() >= REQUIRED_CANDIDATE_CHECKS or not all(
            by_key[key] for key in REQUIRED_CANDIDATE_CHECKS
        ):
            return False
    return True


def _valid_candidate_numbers(candidate: dict[str, Any]) -> bool:
    try:
        bid = float(candidate.get("bid"))
        ask = float(candidate.get("ask"))
        strike = float(candidate.get("strike"))
        delta = float(candidate.get("delta"))
        dte = int(candidate.get("dte"))
        metrics = candidate.get("metrics", {})
        premium_yield = float(metrics.get("premium_yield"))
        spread_ratio = float(metrics.get("spread_ratio"))
    except (TypeError, ValueError, AttributeError):
        return False
    return (
        0 < bid <= ask
        and strike > 0
        and 0 < delta < 1
        and dte > 0
        and 0 < premium_yield < 1
        and 0 <= spread_ratio < 1
    )
