from typing import Any, TypedDict


class AgentState(TypedDict, total=False):
    input: dict[str, Any]
    normalized: dict[str, Any]
    classification: dict[str, Any]
    policy: dict[str, Any]
    context_patch: dict[str, Any]
    context_status: dict[str, Any]
    analysis: dict[str, Any]
    portfolio_explanation: dict[str, Any]
    output: dict[str, Any]
