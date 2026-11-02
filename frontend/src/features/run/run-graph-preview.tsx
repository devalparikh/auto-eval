"use client";

import type { Edge, Node, NodeProps } from "@xyflow/react";
import { useMemo, type ReactNode } from "react";
import { GraphCanvas, useIsGraphNodeSelected } from "@/components/graph-canvas";
import { SmoothHeight } from "@/components/smooth-height";
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
    const selection = resourceSelections[definitionNode.id];
    const view = graphNodeView(definitionNode, {
      entry: definitionNode.id === definition.entry_point,
      output: definitionNode.id === definition.output_node,
      selection,
      missingRequiredSelection: Boolean(
        definitionNode.resource_policy?.required && !selection,
      ),
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
      data: { view },
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
  captureNodeOutputs,
  selectedNodeId,
  selectedNodeContent,
  onSelectNode,
}: {
  definition: GraphDefinition;
  resourceSelections: Record<string, NodeResourceSelection>;
  captureNodeOutputs: boolean;
  selectedNodeId: string;
  selectedNodeContent?: ReactNode;
  onSelectNode: (nodeId: string) => void;
}) {
  const { nodes, edges } = useMemo(
    () => buildRunGraphPreview(definition, resourceSelections),
    [definition, resourceSelections],
  );
  const maximumX = Math.max(0, ...nodes.map((node) => node.position.x));
  const maximumY = Math.max(0, ...nodes.map((node) => node.position.y));
  const selectedView =
    nodes.find((node) => node.id === selectedNodeId)?.data.view ?? null;
  const snapshotPolicy = selectedView?.definition.snapshot_policy;
  const keepsOptionalCopy = Boolean(
    snapshotPolicy &&
    snapshotPolicy.binding_mode !== "consume" &&
    !snapshotPolicy.required,
  );

  return (
    <div className="grid min-w-0 gap-2">
      <GraphLegend types={nodes.map((node) => node.data.view.type)} />
      <GraphCanvas
        ariaLabel="Selected graph execution preview"
        className={graphHeightClass(graphRowCount(nodes))}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitViewOptions={previewFitOptions}
        minZoom={0.12}
        maxZoom={1.4}
        selectedNodeId={selectedNodeId}
        onSelectNode={onSelectNode}
        translateExtent={[
          [-320, -260],
          [maximumX + nodeWidth + 320, maximumY + nodeHeight + 260],
        ]}
      />
      <div className="node-details-panel min-w-0">
        <SmoothHeight>
          <div key={selectedNodeId} className="swap-in">
            {selectedView ? (
              <GraphNodeDetails view={selectedView}>
                {keepsOptionalCopy ? (
                  <p className="px-4 py-3 text-[10px] leading-5 text-[var(--text-muted)]">
                    {captureNodeOutputs
                      ? "If this node uses live data, this run saves it for replay."
                      : "If this node uses live data, this trace cannot be added to a dataset."}
                  </p>
                ) : null}
                {selectedNodeContent}
              </GraphNodeDetails>
            ) : (
              <GraphNodeDetailsEmpty />
            )}
          </div>
        </SmoothHeight>
      </div>
    </div>
  );
}

function RunPreviewNode({ id, data }: NodeProps<Node<RunPreviewNodeData>>) {
  const selected = useIsGraphNodeSelected(id);
  return <GraphNodeCard view={data.view} selected={selected} width={nodeWidth} />;
}
