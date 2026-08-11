from autoeval_api.agent_systems.portfolio_analyst.snapshots import SYNTHETIC_SNAPSHOT_ID

PORTFOLIO_QUERY_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "assumptions": {"type": "array", "items": {"type": "string"}},
                "risks": {"type": "array", "items": {"type": "string"}},
                "fact_ids": {"type": "array", "items": {"type": "string"}},
                "candidate_ids": {"type": "array", "items": {"type": "string"}},
            },
            "required": [
                "summary",
                "assumptions",
                "risks",
                "fact_ids",
                "candidate_ids",
            ],
            "additionalProperties": False,
        }
    },
    "required": ["answer"],
    "additionalProperties": False,
}

PORTFOLIO_QUERY_GRAPH = {
    "entry_point": "resolve_portfolio_snapshot",
    "output_node": "apply_portfolio_query_safety",
    "nodes": [
        {
            "id": "resolve_portfolio_snapshot",
            "label": "Resolve immutable portfolio snapshot",
            "kind": "deterministic",
            "handler": "resolve_portfolio_snapshot",
            "task": None,
        },
        {
            "id": "normalize_portfolio_query",
            "label": "Normalize indexed portfolio query",
            "kind": "deterministic",
            "handler": "normalize_portfolio_query",
            "task": None,
        },
        {
            "id": "load_portfolio_market_data",
            "label": "Resolve or fetch external options observation",
            "kind": "deterministic",
            "handler": "load_portfolio_market_data",
            "task": None,
            "runtime_input_policy": {
                "source": "options_chain",
                "schema_version": 1,
                "required": False,
                "runtime_mode": "refresh",
                "evaluation_mode": "locked",
            },
            "snapshot_policy": {
                "output_key": "options_chain",
                "snapshot_kind": "external_observation",
                "schema_version": 1,
                "binding_mode": "produce_or_consume",
                "reveal_policy_key": "external_observation",
                "required": False,
            },
        },
        {
            "id": "validate_portfolio_query",
            "label": "Validate snapshot and market context",
            "kind": "deterministic",
            "handler": "validate_portfolio_query",
            "task": None,
        },
        {
            "id": "calculate_portfolio_answer",
            "label": "Calculate grounded candidates",
            "kind": "deterministic",
            "handler": "calculate_portfolio_answer",
            "task": None,
        },
        {
            "id": "build_portfolio_model_context",
            "label": "Build provider-safe model context",
            "kind": "deterministic",
            "handler": "build_portfolio_model_context",
            "task": None,
        },
        {
            "id": "explain_portfolio_answer",
            "label": "Explain computed answer",
            "kind": "llm",
            "handler": "merge_portfolio_query_explanation",
            "task": "explain_portfolio_query",
            "prompt_key": "portfolio-query-explanation",
            "response_schema": PORTFOLIO_QUERY_RESPONSE_SCHEMA,
        },
        {
            "id": "apply_portfolio_query_safety",
            "label": "Apply portfolio query safety",
            "kind": "deterministic",
            "handler": "apply_portfolio_query_safety",
            "task": None,
        },
    ],
    "edges": [
        {"source": "resolve_portfolio_snapshot", "target": "normalize_portfolio_query"},
        {"source": "normalize_portfolio_query", "target": "load_portfolio_market_data"},
        {"source": "load_portfolio_market_data", "target": "validate_portfolio_query"},
        {"source": "validate_portfolio_query", "target": "calculate_portfolio_answer"},
        {
            "source": "calculate_portfolio_answer",
            "target": "build_portfolio_model_context",
        },
        {"source": "build_portfolio_model_context", "target": "explain_portfolio_answer"},
        {"source": "explain_portfolio_answer", "target": "apply_portfolio_query_safety"},
    ],
}

PORTFOLIO_QUERY_PROMPT = """You explain deterministic analysis over an indexed portfolio.

Use only the supplied portfolio_model_context. Never invent positions, prices, option contracts,
quotes, earnings dates, tax facts, fills, or calculations. For covered-call questions, explain
the ranked candidates and assignment tradeoffs computed by deterministic nodes. Do not change
their order, numbers, eligibility, or policy checks. If the status is blocked,
needs_market_data, or unsupported, explain what is missing instead of proposing a trade. Return
one JSON object with `answer` containing `summary`, `assumptions`, `risks`, `fact_ids`, and
`candidate_ids`. Cite only fact_id and candidate_id values that exist in portfolio_model_context;
use empty lists when none support the answer. Do not issue an imperative transaction instruction."""

PORTFOLIO_QUERY_INPUT_TEMPLATE = {
    "question": "Which covered-call candidate best fits my current policy?",
    "snapshot_id": SYNTHETIC_SNAPSHOT_ID,
    "policy": {
        "min_dte": 21,
        "max_dte": 45,
        "min_delta": 0.15,
        "max_delta": 0.3,
        "target_delta": 0.2,
        "min_open_interest": 500,
        "max_bid_ask_spread_ratio": 0.12,
        "min_strike_upside": 0.05,
        "max_quote_age_hours": 24,
        "max_greeks_age_hours": 4,
        "earnings_blackout": True,
        "max_contracts_per_symbol": 1,
    },
}
