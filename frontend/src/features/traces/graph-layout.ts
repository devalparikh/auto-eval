import type { Edge, Node } from "@xyflow/react";
import { graphLevels } from "@/features/graph/layout";
import { graphNodeView, type GraphNodeView } from "@/features/graph/node-view";
import type { Trace } from "@/lib/types";

export type TraceNodeData = {
  view: GraphNodeView;
  selected: boolean;
  status: string;
  latency: number;
  cost: number;
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
    const view = graphNodeView(node, {
      entry: node.id === definition.entry_point,
      output: node.id === definition.output_node,
    });
    return {
      id: node.id,
      type: "traceNode",
      position: { x: level * 278, y: index * 150 },
      initialWidth: 208,
      initialHeight: 118,
      ariaLabel: view.ariaLabel,
      data: {
        view,
        selected: selectedNodeId === node.id,
        status: span?.status ?? "queued",
        latency: span?.latency_ms ?? 0,
        cost: span?.cost_usd ?? 0,
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
