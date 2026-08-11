import type { Edge, Node } from "@xyflow/react";
import type { GraphNodeDefinition, Trace } from "@/lib/types";

export type TraceNodeData = {
  definition: GraphNodeDefinition;
  status: string;
  latency: number;
  cost: number;
  selected: boolean;
  snapshotId: string | null;
  snapshotRole: "produced" | "consumed" | null;
  snapshotMode: string | null;
};

export function buildTraceGraph(
  trace: Trace,
  selectedNodeId: string | null,
): { nodes: Node<TraceNodeData>[]; edges: Edge[] } {
  const definition = trace.graph_definition;
  if (!definition) return { nodes: [], edges: [] };

  const levels = graphLevels(definition.nodes, definition.edges);
  const levelCounts = new Map<number, number>();
  const nodes = definition.nodes.map((node) => {
    const level = levels.get(node.id) ?? 0;
    const index = levelCounts.get(level) ?? 0;
    levelCounts.set(level, index + 1);
    const span = trace.spans.find((item) => item.node_id === node.id);
    return {
      id: node.id,
      type: "traceNode",
      position: { x: level * 278, y: index * 150 },
      data: {
        definition: node,
        status: span?.status ?? "queued",
        latency: span?.latency_ms ?? 0,
        cost: span?.cost_usd ?? 0,
        selected: selectedNodeId === node.id,
        snapshotId:
          span?.node_snapshot_id ?? span?.runtime_input_snapshot_id ?? null,
        snapshotRole: span?.snapshot_role ?? null,
        snapshotMode: span?.snapshot_resolution_mode ?? null,
      },
    };
  });
  const edges = definition.edges.map((edge) => ({
    id: `${edge.source}-${edge.target}`,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    animated: trace.status === "running",
    style: { stroke: "var(--border-strong)", strokeWidth: 1.5 },
  }));
  return { nodes, edges };
}

export function graphLevels(
  nodes: GraphNodeDefinition[],
  edges: Array<{ source: string; target: string }>,
): Map<string, number> {
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));

  edges.forEach((edge) => {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  });

  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  const levels = new Map(queue.map((id) => [id, 0]));

  while (queue.length) {
    const source = queue.shift();
    if (!source) break;
    for (const target of outgoing.get(source) ?? []) {
      const nextLevel = (levels.get(source) ?? 0) + 1;
      levels.set(target, Math.max(levels.get(target) ?? 0, nextLevel));
      incoming.set(target, (incoming.get(target) ?? 1) - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }

  return levels;
}
