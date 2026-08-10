from collections import defaultdict, deque
from typing import Any


def topological_sequence(definition: dict[str, Any]) -> dict[str, int]:
    incoming = {node["id"]: 0 for node in definition["nodes"]}
    outgoing: dict[str, list[str]] = defaultdict(list)
    for edge in definition["edges"]:
        incoming[edge["target"]] += 1
        outgoing[edge["source"]].append(edge["target"])

    queue = deque(node_id for node_id, count in incoming.items() if count == 0)
    order: dict[str, int] = {}
    while queue:
        node_id = queue.popleft()
        order[node_id] = len(order)
        for target in outgoing[node_id]:
            incoming[target] -= 1
            if incoming[target] == 0:
                queue.append(target)

    if len(order) != len(incoming):
        raise ValueError("Agent graph must be acyclic")
    return order


def sink_node_ids(definition: dict[str, Any]) -> list[str]:
    source_ids = {edge["source"] for edge in definition["edges"]}
    return [node["id"] for node in definition["nodes"] if node["id"] not in source_ids]
