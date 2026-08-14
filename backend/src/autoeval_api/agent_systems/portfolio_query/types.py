from typing import Any, TypedDict


class PortfolioSnapshotReference(TypedDict, total=False):
    id: str
    resource_identity: str
    producer_system_key: str
    producer_node_id: str
    content_hash: str
    schema_version: int
    as_of: str
    is_synthetic: bool
    resolution_status: str
    error: str


class PortfolioModelContext(TypedDict):
    schema_version: int
    question: str
    intent: str
    status: str
    snapshot: dict[str, Any]
    market_data: dict[str, Any]
    portfolio_facts: dict[str, Any]
    candidates: list[dict[str, Any]]
    blocked_reasons: list[str]
    safety: dict[str, Any]
