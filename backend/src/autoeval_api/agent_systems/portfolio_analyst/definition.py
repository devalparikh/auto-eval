PORTFOLIO_GRAPH = {
    "entry_point": "normalize_portfolio",
    "output_node": "apply_financial_safety",
    "nodes": [
        {
            "id": "normalize_portfolio",
            "label": "Normalize portfolio",
            "kind": "deterministic",
            "handler": "normalize_portfolio",
            "task": None,
        },
        {
            "id": "extract_context",
            "label": "Extract investor context",
            "kind": "llm",
            "handler": "merge_portfolio_context",
            "task": "extract_portfolio_context",
        },
        {
            "id": "validate_context",
            "label": "Validate context",
            "kind": "deterministic",
            "handler": "validate_portfolio_context",
            "task": None,
        },
        {
            "id": "calculate_exposure",
            "label": "Calculate exposures",
            "kind": "deterministic",
            "handler": "calculate_portfolio_exposure",
            "task": None,
        },
        {
            "id": "explain_findings",
            "label": "Explain findings",
            "kind": "llm",
            "handler": "merge_portfolio_explanation",
            "task": "explain_portfolio",
        },
        {
            "id": "apply_financial_safety",
            "label": "Apply financial safety",
            "kind": "deterministic",
            "handler": "apply_financial_safety",
            "task": None,
        },
    ],
    "edges": [
        {"source": "normalize_portfolio", "target": "extract_context"},
        {"source": "extract_context", "target": "validate_context"},
        {"source": "validate_context", "target": "calculate_exposure"},
        {"source": "calculate_exposure", "target": "explain_findings"},
        {"source": "explain_findings", "target": "apply_financial_safety"},
    ],
}

PORTFOLIO_PROMPT = """You are the explanation layer for a portfolio-analysis graph.

The deterministic nodes own all allocation, concentration, bucket, liquidity, and scenario
calculations. Never change their numbers. Explain the computed facts and tradeoffs in plain
language for the portfolio owner. Ask for missing context when analysis_ready is false.

Do not prescribe transactions, timing, price targets, or guaranteed outcomes. Do not claim to
be a fiduciary. Return one JSON object only and keep observations tied to supplied facts."""

PORTFOLIO_INPUT_TEMPLATE = {
    "is_synthetic": True,
    "profile": {
        "goal": "Long-term growth with a durable core",
        "time_horizon_years": 15,
        "risk_tolerance": "high",
        "liquidity_need": "low",
    },
    "holdings": [
        {
            "symbol": "BROAD_MARKET",
            "asset_class": "us_equity",
            "bucket": "core",
            "weight": 0.55,
            "exposures": {"technology": 0.28, "broad_market": 1.0},
        },
        {
            "symbol": "QUALITY_GROWTH",
            "asset_class": "us_equity",
            "bucket": "growth",
            "weight": 0.22,
            "exposures": {"technology": 0.62, "broad_market": 0.75},
        },
        {
            "symbol": "INTL_MARKET",
            "asset_class": "international_equity",
            "bucket": "diversifier",
            "weight": 0.15,
            "exposures": {"international": 1.0},
        },
        {
            "symbol": "CASH",
            "asset_class": "cash",
            "bucket": "liquidity",
            "weight": 0.08,
            "exposures": {"cash": 1.0},
        },
    ],
    "bucket_policies": [
        {"key": "core", "min_weight": 0.45, "max_weight": 0.7},
        {"key": "growth", "min_weight": 0.1, "max_weight": 0.3},
        {"key": "liquidity", "min_weight": 0.05, "max_weight": 0.2},
    ],
    "scenarios": [
        {
            "name": "Technology drawdown",
            "shocks": {"technology": -0.35, "broad_market": -0.12},
        }
    ],
}
