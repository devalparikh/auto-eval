"use client";

import type { Edge, Node, NodeProps } from "@xyflow/react";
import { useMemo, type ReactNode } from "react";
import { GraphCanvas } from "@/components/graph-canvas";
import { GraphLegend, GraphNodeCard } from "@/features/graph/graph-node-card";
import {
  graphHeightClass,
  graphLevels,
  graphRowCount,
} from "@/features/graph/layout";
import {
  GraphNodeDetails,
  GraphNodeDetailsEmpty,
} from "@/features/graph/node-details";
import { graphNodeView, type GraphNodeView } from "@/features/graph/node-view";
import type { GraphDefinition, NodeResourceSelection } from "@/lib/types";

type RunPreviewNodeData = {
  view: GraphNodeView;
  selected: boolean;
};

const nodeTypes = { runPreviewNode: RunPreviewNode };
const nodeWidth = 204;
const nodeHeight = 96;
const stageSpacing = 236;
const parallelNodeSpacing = 160;
const previewFitOptions = {
  padding: 0.16,
  minZoom: 0.12,
  maxZoom: 0.86,
};

export function buildRunGraphPreview(
  definition: GraphDefinition,
  resourceSelections: Record<string, NodeResourceSelection>,
  selectedNodeId?: string | null,
): { nodes: Node<RunPreviewNodeData>[]; edges: Edge[] } {
  const levels = graphLevels(definition.nodes, definition.edges);
  const levelCounts = new Map<number, number>();
  const nodes = definition.nodes.map((definitionNode) => {
    const level = levels.get(definitionNode.id) ?? 0;
    const index = levelCounts.get(level) ?? 0;
    const targets = definition.edges
      .filter((edge) => edge.source === definitionNode.id)
      .map((edge) => edge.target);
    levelCounts.set(level, index + 1);
    const view = graphNodeView(definitionNode, {
      entry: definitionNode.id === definition.entry_point,
      output: definitionNode.id === definition.output_node,
      selection: resourceSelections[definitionNode.id],
      nextNodeIds: targets,
    });
    return {
      id: definitionNode.id,
      type: "runPreviewNode",
      position: {
        x: level * stageSpacing,
        y: index * parallelNodeSpacing,
      },
      initialWidth: nodeWidth,
      initialHeight: nodeHeight,
      ariaLabel: view.ariaLabel,
      data: { view, selected: definitionNode.id === selectedNodeId },
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

export function RunGraphPreview({
  definition,
  resourceSelections,
  selectedNodeId,
  onSelectNode,
  renderNodeControls,
}: {
  definition: GraphDefinition;
  resourceSelections: Record<string, NodeResourceSelection>;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  /** What a run lets the reader change on the selected node. */
  renderNodeControls?: (view: GraphNodeView) => ReactNode;
}) {
  const { nodes, edges } = useMemo(
    () => buildRunGraphPreview(definition, resourceSelections, selectedNodeId),
    [definition, resourceSelections, selectedNodeId],
  );
  const maximumX = Math.max(0, ...nodes.map((node) => node.position.x));
  const maximumY = Math.max(0, ...nodes.map((node) => node.position.y));
  const selectedView =
    nodes.find((node) => node.id === selectedNodeId)?.data.view ?? null;

  return (
    <div className="grid min-w-0 gap-2">
      <GraphLegend types={nodes.map((node) => node.data.view.type)} />
      <GraphCanvas
        ariaLabel="Selected graph execution preview"
        className={`border border-[var(--border)] ${graphHeightClass(graphRowCount(nodes))}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitViewOptions={previewFitOptions}
        minZoom={0.12}
        maxZoom={1.4}
        elementsSelectable
        onNodeClick={(_, node) => onSelectNode(node.id)}
        translateExtent={[
          [-320, -260],
          [maximumX + nodeWidth + 320, maximumY + nodeHeight + 260],
        ]}
      />
      <div className="min-w-0 border border-[var(--border)]">
        {selectedView ? (
          <GraphNodeDetails view={selectedView}>
            {renderNodeControls?.(selectedView)}
          </GraphNodeDetails>
        ) : (
          <GraphNodeDetailsEmpty />
        )}
      </div>
    </div>
  );
}

function RunPreviewNode({ data }: NodeProps<Node<RunPreviewNodeData>>) {
  return (
    <GraphNodeCard view={data.view} selected={data.selected} width={nodeWidth} />
  );
}
