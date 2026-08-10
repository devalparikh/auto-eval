import pytest

from autoeval_api.graph.topology import sink_node_ids, topological_sequence


def test_topology_orders_nodes_and_finds_sinks() -> None:
    definition = {
        "nodes": [{"id": "start"}, {"id": "left"}, {"id": "right"}, {"id": "end"}],
        "edges": [
            {"source": "start", "target": "left"},
            {"source": "start", "target": "right"},
            {"source": "left", "target": "end"},
            {"source": "right", "target": "end"},
        ],
    }

    order = topological_sequence(definition)

    assert order["start"] < order["left"] < order["end"]
    assert order["start"] < order["right"] < order["end"]
    assert sink_node_ids(definition) == ["end"]


def test_topology_rejects_cycles() -> None:
    definition = {
        "nodes": [{"id": "one"}, {"id": "two"}],
        "edges": [
            {"source": "one", "target": "two"},
            {"source": "two", "target": "one"},
        ],
    }

    with pytest.raises(ValueError, match="acyclic"):
        topological_sequence(definition)
