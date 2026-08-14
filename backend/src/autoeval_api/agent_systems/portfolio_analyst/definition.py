PORTFOLIO_GRAPH = {
    "entry_point": "normalize_portfolio",
    "output_node": "persist_portfolio_snapshot",
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
            "prompt_key": "portfolio-index-context-extraction",
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
            "prompt_key": "portfolio-index-explanation",
        },
        {
            "id": "apply_financial_safety",
            "label": "Apply financial safety",
            "kind": "deterministic",
            "handler": "apply_financial_safety",
            "task": None,
        },
        {
            "id": "persist_portfolio_snapshot",
            "label": "Persist immutable portfolio snapshot",
            "kind": "deterministic",
            "handler": "persist_portfolio_snapshot",
            "task": None,
            "snapshot_policy": {
                "output_key": "portfolio_state",
                "snapshot_kind": "state",
                "schema_version": 1,
                "binding_mode": "produce",
                "reveal_policy_key": "portfolio_state",
                "required": True,
            },
        },
    ],
    "edges": [
        {"source": "normalize_portfolio", "target": "extract_context"},
        {"source": "extract_context", "target": "validate_context"},
        {"source": "validate_context", "target": "calculate_exposure"},
        {"source": "calculate_exposure", "target": "explain_findings"},
        {"source": "explain_findings", "target": "apply_financial_safety"},
        {"source": "apply_financial_safety", "target": "persist_portfolio_snapshot"},
    ],
}

PORTFOLIO_PROMPT = """You are the explanation layer for a portfolio-analysis graph.

The deterministic nodes own all allocation, concentration, bucket, liquidity, and scenario
calculations. Never change their numbers. Explain the computed facts and tradeoffs in plain
language for the portfolio owner. Ask for missing context when analysis_ready is false.

Do not prescribe transactions, timing, price targets, or guaranteed outcomes. Do not claim to
be a fiduciary. Return one JSON object only and keep observations tied to supplied facts."""

PORTFOLIO_CONTEXT_EXTRACTION_PROMPT = """You extract supplied investor and portfolio context.

Use only the normalized input. Return one JSON object with `context_patch`; do not calculate
allocations, exposures, concentration, scenarios, or recommendations. Preserve the user's stated
goal, horizon, risk tolerance, liquidity need, holdings, policies, and scenarios without inventing
missing facts. Do not prescribe transactions or claim to be a fiduciary."""

PORTFOLIO_EXPLANATION_PROMPT = """You explain deterministic portfolio-analysis results.

The deterministic nodes own every allocation, concentration, bucket, liquidity, and scenario
calculation. Never change their numbers. Explain the supplied findings and tradeoffs in plain
language for the portfolio owner. Ask for missing context when analysis_ready is false.

Do not prescribe transactions, timing, price targets, or guaranteed outcomes. Do not claim to be
a fiduciary. Return one JSON object with `portfolio_explanation` only, tied to supplied facts."""

PORTFOLIO_INPUT_TEMPLATE = {
    "is_synthetic": True,
    "portfolio_identity": "synthetic-main",
    "snapshot_as_of": "2026-08-10T16:00:00Z",
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
