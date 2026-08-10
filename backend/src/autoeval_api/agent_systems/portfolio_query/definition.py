from autoeval_api.agent_systems.portfolio_query.snapshot import snapshot_content_hash

PORTFOLIO_QUERY_GRAPH = {
    "entry_point": "normalize_portfolio_query",
    "output_node": "apply_portfolio_query_safety",
    "nodes": [
        {
            "id": "normalize_portfolio_query",
            "label": "Normalize indexed portfolio query",
            "kind": "deterministic",
            "handler": "normalize_portfolio_query",
            "task": None,
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
            "id": "explain_portfolio_answer",
            "label": "Explain computed answer",
            "kind": "llm",
            "handler": "merge_portfolio_query_explanation",
            "task": "explain_portfolio_query",
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
        {"source": "normalize_portfolio_query", "target": "validate_portfolio_query"},
        {"source": "validate_portfolio_query", "target": "calculate_portfolio_answer"},
        {"source": "calculate_portfolio_answer", "target": "explain_portfolio_answer"},
        {"source": "explain_portfolio_answer", "target": "apply_portfolio_query_safety"},
    ],
}

PORTFOLIO_QUERY_PROMPT = """You explain deterministic analysis over an indexed portfolio.

Use only the supplied query_analysis. Never invent positions, prices, option contracts, quotes,
earnings dates, tax facts, fills, or calculations. For covered-call questions, explain the ranked
candidates and assignment tradeoffs computed by deterministic nodes. Do not change their order,
numbers, eligibility, or policy checks. If the status is blocked, needs_market_data, or
unsupported, explain what is missing instead of proposing a trade. Return one JSON object with
`answer` containing `summary`, `assumptions`, and `risks`. Do not issue an imperative transaction
instruction."""

PORTFOLIO_QUERY_INPUT_TEMPLATE = {
    "question": "Which supplied covered-call candidate best fits my current policy?",
    "snapshot": {
        "id": "synthetic-indexed-portfolio-v1",
        "content_hash": "",
        "schema_version": 1,
        "as_of": "synthetic-current",
        "is_synthetic": True,
        "positions": [
            {
                "symbol": "NVDA",
                "instrument_type": "equity",
                "shares": 200,
                "pledged_shares": 100,
                "weight": 0.12,
                "bucket": "tactical",
                "covered_calls_allowed": True,
                "assignment_acceptable": True,
                "do_not_touch": False,
                "min_exit_price": 155.0,
                "tags": ["ai", "semiconductor"],
            },
            {
                "symbol": "MSFT",
                "instrument_type": "equity",
                "shares": 60,
                "pledged_shares": 0,
                "weight": 0.1,
                "bucket": "core",
                "covered_calls_allowed": False,
                "assignment_acceptable": False,
                "do_not_touch": True,
                "tags": ["quality", "software"],
            },
        ],
    },
    "market_context": {
        "source": "supplied-synthetic-option-chain",
        "quote_age_hours": 1.0,
        "contracts": [
            {
                "contract_id": "NVDA_SYNTH_CALL_160",
                "symbol": "NVDA",
                "option_type": "call",
                "expiry": "synthetic-35d",
                "dte": 35,
                "strike": 160.0,
                "underlying_price": 150.0,
                "bid": 3.2,
                "ask": 3.45,
                "delta": 0.22,
                "open_interest": 1800,
                "earnings_before_expiry": False,
                "multiplier": 100,
            },
            {
                "contract_id": "NVDA_SYNTH_CALL_165",
                "symbol": "NVDA",
                "option_type": "call",
                "expiry": "synthetic-35d",
                "dte": 35,
                "strike": 165.0,
                "underlying_price": 150.0,
                "bid": 2.15,
                "ask": 2.55,
                "delta": 0.16,
                "open_interest": 900,
                "earnings_before_expiry": False,
                "multiplier": 100,
            },
        ],
    },
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
        "earnings_blackout": True,
        "max_contracts_per_symbol": 1,
    },
}

PORTFOLIO_QUERY_INPUT_TEMPLATE["snapshot"]["content_hash"] = snapshot_content_hash(
    PORTFOLIO_QUERY_INPUT_TEMPLATE["snapshot"]
)
