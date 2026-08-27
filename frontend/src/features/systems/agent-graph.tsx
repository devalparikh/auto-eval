"use client";

import type { Edge, Node, NodeProps } from "@xyflow/react";
import { useMemo, useState } from "react";
import { GraphCanvas } from "@/components/graph-canvas";
import { GraphLegend, GraphNodeCard } from "@/features/graph/graph-node-card";
import { graphLevels } from "@/features/graph/layout";
import {
  GraphNodeDetails,
  GraphNodeDetailsEmpty,
} from "@/features/graph/node-details";
import { graphNodeView, type GraphNodeView } from "@/features/graph/node-view";
import type { GraphDefinition } from "@/lib/types";

type AgentNodeData = {
  view: GraphNodeView;
  selected: boolean;
};

const nodeTypes = { agentNode: AgentNode };
const inlineFitOptions = { padding: 0.2, minZoom: 0.1, maxZoom: 0.88 };
const fullscreenFitOptions = { padding: 0.16, minZoom: 0.1, maxZoom: 1 };

export function buildAgentGraph(
  definition: GraphDefinition,
  selectedNodeId?: string,
): {
  nodes: Node<AgentNodeData>[];
  edges: Edge[];
} {
  const levels = graphLevels(definition.nodes, definition.edges);
  const levelCounts = new Map<number, number>();
  const nodes = definition.nodes.map((node) => {
    const level = levels.get(node.id) ?? 0;
    const index = levelCounts.get(level) ?? 0;
    levelCounts.set(level, index + 1);
    const view = graphNodeView(node, {
      entry: node.id === definition.entry_point,
      output: node.id === definition.output_node,
    });
    return {
      id: node.id,
      type: "agentNode",
      position: { x: level * 286, y: index * 172 },
      initialWidth: 216,
      initialHeight: 100,
      ariaLabel: view.ariaLabel,
      data: { view, selected: node.id === selectedNodeId },
    };
  });
  const edges = definition.edges.map((edge) => ({
    id: `${edge.source}-${edge.target}`,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    style: { stroke: "var(--border-strong)", strokeWidth: 1.5 },
  }));
  return { nodes, edges };
}

export function isGraphDefinition(value: unknown): value is GraphDefinition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GraphDefinition>;
  return (
    typeof candidate.entry_point === "string" &&
    typeof candidate.output_node === "string" &&
    Array.isArray(candidate.nodes) &&
    candidate.nodes.every(
      (node) =>
        Boolean(node) &&
        typeof node.id === "string" &&
        typeof node.label === "string" &&
        (node.kind === "deterministic" || node.kind === "llm") &&
        typeof node.handler === "string",
    ) &&
    Array.isArray(candidate.edges) &&
    candidate.edges.every(
      (edge) =>
        Boolean(edge) &&
        typeof edge.source === "string" &&
        typeof edge.target === "string",
    )
  );
}

export function AgentGraph({
  definition,
  fullscreen = false,
}: {
  definition: GraphDefinition;
  fullscreen?: boolean;
}) {
  const [selectedNodeId, setSelectedNodeId] = useState(definition.entry_point);
  const [shownEntryPoint, setShownEntryPoint] = useState(definition.entry_point);

  // A different graph means a different set of nodes: fall back to its entry
  // point rather than keeping a selection that no longer exists.
  if (shownEntryPoint !== definition.entry_point) {
    setShownEntryPoint(definition.entry_point);
    setSelectedNodeId(definition.entry_point);
  }

  const { nodes, edges } = useMemo(
    () => buildAgentGraph(definition, selectedNodeId),
    [definition, selectedNodeId],
  );
  const selectedView =
    nodes.find((node) => node.id === selectedNodeId)?.data.view ?? null;

  const details = (
    <div className="min-w-0 border border-[var(--border-strong)]">
      {selectedView ? (
        <GraphNodeDetails view={selectedView} />
      ) : (
        <GraphNodeDetailsEmpty />
      )}
    </div>
  );

  return (
    <div className={`grid min-w-0 gap-3 ${fullscreen ? "p-4" : ""}`}>
      <GraphLegend types={nodes.map((node) => node.data.view.type)} />
      <div
        className={`grid min-w-0 gap-3 ${
          fullscreen ? "xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start" : ""
        }`}
      >
        <GraphCanvas
          ariaLabel="Agent graph structure"
          className={`border border-[var(--border-strong)] ${
            fullscreen ? "h-[calc(100dvh-12rem)]" : "h-[400px]"
          }`}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitViewOptions={fullscreen ? fullscreenFitOptions : inlineFitOptions}
          minZoom={0.1}
          maxZoom={1.5}
          elementsSelectable
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          zoomOnScroll={fullscreen}
        />
        {fullscreen ? (
          <div className="min-w-0 xl:max-h-[calc(100dvh-12rem)] xl:overflow-y-auto">
            {details}
          </div>
        ) : (
          details
        )}
      </div>
    </div>
  );
}

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  return <GraphNodeCard view={data.view} selected={data.selected} width={212} />;
}
