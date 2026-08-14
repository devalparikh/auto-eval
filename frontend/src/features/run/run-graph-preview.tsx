"use client";

import {
  BracketsCurlyIcon,
  CloudArrowDownIcon,
  DatabaseIcon,
  WaveformIcon,
} from "@phosphor-icons/react";
import {
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useMemo } from "react";
import { GraphCanvas } from "@/components/graph-canvas";
import { graphLevels } from "@/features/traces/graph-layout";
import type {
  GraphDefinition,
  GraphNodeDefinition,
  NodeResourceSelection,
} from "@/lib/types";

export type RunNodeClassification =
  | "deterministic calculation"
  | "deterministic current resource"
  | "deterministic live external"
  | "snapshot replay"
  | "LLM";

type RunPreviewNodeData = {
  definition: GraphNodeDefinition;
  selection?: NodeResourceSelection;
  captureNodeOutputs: boolean;
  entry: boolean;
  output: boolean;
  targets: string[];
};

const nodeTypes = { runPreviewNode: RunPreviewNode };
const nodeWidth = 204;
const nodeHeight = 112;
const stageSpacing = 236;
const parallelNodeSpacing = 160;
const previewFitOptions = {
  padding: 0.16,
  minZoom: 0.12,
  maxZoom: 0.86,
};

export function classifyRunNode(
  node: GraphNodeDefinition,
  resourceSelection?: NodeResourceSelection,
): RunNodeClassification {
  if (node.kind === "llm") return "LLM";
  if (node.resource_policy) {
    const mode = resourceSelection?.mode ?? node.resource_policy.runtime_mode;
    return mode === "locked"
      ? "snapshot replay"
      : "deterministic current resource";
  }
  if (node.runtime_input_policy) {
    return node.runtime_input_policy.runtime_mode === "locked"
      ? "snapshot replay"
      : "deterministic live external";
  }
  if (node.snapshot_policy?.binding_mode === "consume") {
    return "snapshot replay";
  }
  return "deterministic calculation";
}

export function buildRunGraphPreview(
  definition: GraphDefinition,
  resourceSelections: Record<string, NodeResourceSelection>,
  captureNodeOutputs: boolean,
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
    return {
      id: definitionNode.id,
      type: "runPreviewNode",
      position: {
        x: level * stageSpacing,
        y: index * parallelNodeSpacing,
      },
      initialWidth: nodeWidth,
      initialHeight: nodeHeight,
      ariaLabel: [
        definitionNode.label,
        classifyRunNode(definitionNode, resourceSelections[definitionNode.id]),
        definitionNode.id === definition.entry_point ? "entry point" : null,
        definitionNode.id === definition.output_node ? "output node" : null,
        targets.length ? `continues to ${targets.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(", "),
      data: {
        definition: definitionNode,
        selection: resourceSelections[definitionNode.id],
        captureNodeOutputs,
        entry: definitionNode.id === definition.entry_point,
        output: definitionNode.id === definition.output_node,
        targets,
      },
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
}: {
  definition: GraphDefinition;
  resourceSelections: Record<string, NodeResourceSelection>;
  captureNodeOutputs: boolean;
}) {
  const { nodes, edges } = useMemo(
    () =>
      buildRunGraphPreview(definition, resourceSelections, captureNodeOutputs),
    [captureNodeOutputs, definition, resourceSelections],
  );
  const maximumX = Math.max(0, ...nodes.map((node) => node.position.x));
  const maximumY = Math.max(0, ...nodes.map((node) => node.position.y));

  return (
    <GraphCanvas
      ariaLabel="Selected graph execution preview"
      className="h-[350px] border border-[var(--border)] md:h-[380px]"
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitViewOptions={previewFitOptions}
      minZoom={0.12}
      maxZoom={1.4}
      translateExtent={[
        [-320, -260],
        [maximumX + nodeWidth + 320, maximumY + nodeHeight + 260],
      ]}
    />
  );
}

function RunPreviewNode({ data }: NodeProps<Node<RunPreviewNodeData>>) {
  const classification = classifyRunNode(data.definition, data.selection);
  const requiredCapture =
    data.definition.snapshot_policy?.required &&
    data.definition.snapshot_policy.binding_mode === "produce";
  const optionalRefresh =
    data.definition.runtime_input_policy?.runtime_mode === "refresh" &&
    data.definition.snapshot_policy?.binding_mode !== "consume" &&
    !data.definition.snapshot_policy?.required;
  return (
    <article className="relative min-h-[112px] w-[204px] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-3 shadow-[0_14px_40px_rgba(0,0,0,0.2)]">
      <Handle
        type="target"
        position={Position.Left}
        className="!size-1.5 !border-0 !bg-[var(--border-strong)]"
      />
      <div className="flex items-start gap-2">
        <span className="grid size-7 shrink-0 place-items-center border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--accent)]">
          {iconForClassification(classification)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-semibold">
            {data.definition.label}
          </span>
          <span className="mono mt-1 block text-[8px] leading-4 text-[var(--text-muted)]">
            {classification}
          </span>
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1 border-t border-[var(--border)] pt-2">
        {data.entry ? <PreviewTag>entry</PreviewTag> : null}
        {data.output ? <PreviewTag>output</PreviewTag> : null}
        {data.selection?.mode === "current" ? (
          <PreviewTag>current · {data.selection.identity}</PreviewTag>
        ) : null}
        {data.selection?.mode === "locked" ? (
          <PreviewTag>locked · exact snapshot</PreviewTag>
        ) : null}
        {data.definition.runtime_input_policy?.runtime_mode === "refresh" ? (
          <PreviewTag>run refresh</PreviewTag>
        ) : null}
        {requiredCapture ? <PreviewTag>required capture</PreviewTag> : null}
        {optionalRefresh ? (
          <PreviewTag>
            {data.captureNodeOutputs ? "capture on" : "live · not captured"}
          </PreviewTag>
        ) : null}
        {data.targets.length ? (
          <PreviewTag>to · {data.targets.join(", ")}</PreviewTag>
        ) : null}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!size-1.5 !border-0 !bg-[var(--border-strong)]"
      />
    </article>
  );
}

function iconForClassification(classification: RunNodeClassification) {
  const properties = { size: 14, weight: "bold" as const, "aria-hidden": true };
  if (classification === "LLM") return <WaveformIcon {...properties} />;
  if (
    classification === "snapshot replay" ||
    classification === "deterministic current resource"
  ) {
    return <DatabaseIcon {...properties} />;
  }
  if (classification === "deterministic live external") {
    return <CloudArrowDownIcon {...properties} />;
  }
  return <BracketsCurlyIcon {...properties} />;
}

function PreviewTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="mono bg-[var(--accent-soft)] px-1.5 py-1 text-[8px] text-[var(--accent)]">
      {children}
    </span>
  );
}
