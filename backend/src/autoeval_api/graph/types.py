from typing import Annotated, Any, TypedDict


def merge_state_data(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    """Merge system-owned state channels without teaching the runner their names."""
    return {**left, **right}


class AgentState(TypedDict, total=False):
    input: dict[str, Any]
    data: Annotated[dict[str, Any], merge_state_data]
    output: dict[str, Any]
