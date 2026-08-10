import pytest

from autoeval_api.services.metrics import classification_metrics


def test_classification_metrics_include_macro_scores() -> None:
    expected = [
        {"severity": "critical", "route": "security", "requires_human": True},
        {"severity": "high", "route": "platform", "requires_human": True},
        {"severity": "medium", "route": "support", "requires_human": False},
    ]
    actual = [
        {"severity": "critical", "route": "security", "requires_human": True},
        {"severity": "medium", "route": "platform", "requires_human": False},
        {"severity": "medium", "route": "support", "requires_human": False},
    ]

    metrics = classification_metrics(expected, actual)

    assert metrics["severity_accuracy"] == pytest.approx(2 / 3, abs=1e-6)
    assert metrics["route_accuracy"] == 1
    assert metrics["exact_match"] == pytest.approx(2 / 3, abs=1e-6)
    assert 0 < metrics["f1_macro"] < 1
