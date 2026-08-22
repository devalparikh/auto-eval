import pytest

from autoeval_api.graph.definition import AgentGraphDefinition
from autoeval_api.graph.topology import sink_node_ids, topological_sequence


def _definition(node_ids: list[str], edges: list[tuple[str, str]]) -> AgentGraphDefinition:
    return AgentGraphDefinition.model_validate(
        {
            "entry_point": node_ids[0],
            "output_node": node_ids[-1],
            "nodes": [
                {
                    "id": node_id,
                    "label": node_id,
                    "kind": "deterministic",
                    "handler": node_id,
                }
                for node_id in node_ids
            ],
            "edges": [{"source": source, "target": target} for source, target in edges],
        }
    )


def test_topology_orders_nodes_and_finds_sinks() -> None:
    definition = _definition(
        ["start", "left", "right", "end"],
        [("start", "left"), ("start", "right"), ("left", "end"), ("right", "end")],
    )

    order = topological_sequence(definition)

    assert order["start"] < order["left"] < order["end"]
    assert order["start"] < order["right"] < order["end"]
    assert sink_node_ids(definition) == ["end"]


def test_topology_rejects_cycles() -> None:
    definition = _definition(["one", "two"], [("one", "two"), ("two", "one")])

    with pytest.raises(ValueError, match="acyclic"):
        topological_sequence(definition)
