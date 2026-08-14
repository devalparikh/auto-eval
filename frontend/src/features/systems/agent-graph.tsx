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
import type { GraphDefinition, GraphNodeDefinition } from "@/lib/types";

type AgentNodeData = {
  definition: GraphNodeDefinition;
  entry: boolean;
  output: boolean;
};

const nodeTypes = { agentNode: AgentNode };
const inlineFitOptions = { padding: 0.2, minZoom: 0.1, maxZoom: 0.88 };
const fullscreenFitOptions = { padding: 0.16, minZoom: 0.1, maxZoom: 1 };

export function buildAgentGraph(definition: GraphDefinition): {
  nodes: Node<AgentNodeData>[];
  edges: Edge[];
} {
  const levels = graphLevels(definition.nodes, definition.edges);
  const levelCounts = new Map<number, number>();
  const nodes = definition.nodes.map((node) => {
    const level = levels.get(node.id) ?? 0;
    const index = levelCounts.get(level) ?? 0;
    levelCounts.set(level, index + 1);
    const entry = node.id === definition.entry_point;
    const output = node.id === definition.output_node;
    const runtimePolicy = node.runtime_input_policy;
    const snapshotPolicy = node.snapshot_policy;
    const resourcePolicy = node.resource_policy;
    return {
      id: node.id,
      type: "agentNode",
      position: { x: level * 286, y: index * 172 },
      initialWidth: 216,
      initialHeight: 118,
      ariaLabel: [
        node.label,
        runtimePolicy ? "external input node" : `${node.kind} node`,
        runtimePolicy ? `source ${runtimePolicy.source}` : null,
        runtimePolicy ? `run ${runtimePolicy.runtime_mode}` : null,
        runtimePolicy ? `evaluation ${runtimePolicy.evaluation_mode}` : null,
        runtimePolicy?.schema_version
          ? `schema version ${runtimePolicy.schema_version}`
          : null,
        runtimePolicy && !runtimePolicy.required ? "conditional" : null,
        snapshotPolicy ? `snapshot output ${snapshotPolicy.output_key}` : null,
        snapshotPolicy ? `snapshot ${snapshotPolicy.binding_mode}` : null,
        resourcePolicy ? `saved input ${resourcePolicy.resource_key}` : null,
        resourcePolicy
          ? `run ${resourcePolicy.runtime_mode === "current" ? "latest" : "exact"}`
          : null,
        resourcePolicy
          ? `snapshot kind ${resourcePolicy.producer_snapshot_kind}`
          : null,
        resourcePolicy ? "evaluation exact" : null,
        resourcePolicy
          ? `source ${resourcePolicy.producer_system_key} ${resourcePolicy.producer_node_id}`
          : null,
        node.prompt_key ? `prompt ${node.prompt_key}` : null,
        entry ? "entry point" : null,
        output ? "output node" : null,
      ]
        .filter(Boolean)
        .join(", "),
      data: { definition: node, entry, output },
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
  const { nodes, edges } = useMemo(
    () => buildAgentGraph(definition),
    [definition],
  );
  return (
    <GraphCanvas
      ariaLabel="Agent graph structure"
      className={`border border-[var(--border-strong)] ${
        fullscreen ? "h-[calc(100dvh-8rem)]" : "h-[440px]"
      }`}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitViewOptions={fullscreen ? fullscreenFitOptions : inlineFitOptions}
      minZoom={0.1}
      maxZoom={1.5}
      zoomOnScroll={fullscreen}
    />
  );
}

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const runtimePolicy = data.definition.runtime_input_policy;
  const snapshotPolicy = data.definition.snapshot_policy;
  const resourcePolicy = data.definition.resource_policy;
  const Icon = runtimePolicy
    ? CloudArrowDownIcon
    : resourcePolicy || snapshotPolicy
      ? DatabaseIcon
      : data.definition.kind === "llm"
        ? WaveformIcon
        : BracketsCurlyIcon;
  return (
    <div className="relative w-[216px] rounded-[2px] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-3 shadow-[0_14px_40px_rgba(0,0,0,0.24)]">
      <Handle
        type="target"
        position={Position.Left}
        className="!size-1.5 !border-0 !bg-[var(--border-strong)]"
      />
      <div className="flex items-start gap-2">
        <div
          className={`grid size-7 shrink-0 place-items-center rounded-[2px] border ${
            runtimePolicy || resourcePolicy
              ? "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]"
              : "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-muted)]"
          }`}
        >
          <Icon size={14} weight="bold" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold">
            {data.definition.label}
          </p>
          <p className="mono mt-0.5 text-[8px] tracking-[0.04em] text-[var(--text-faint)]">
            {runtimePolicy
              ? `external input · ${runtimePolicy.source}`
              : resourcePolicy
                ? `saved input: ${resourcePolicy.resource_key}`
                : `${data.definition.kind} · ${data.definition.handler}`}
          </p>
        </div>
      </div>
      <div className="mt-3 flex min-h-5 flex-wrap gap-1 border-t border-[var(--border)] pt-2">
        {data.entry ? <NodeTag>entry</NodeTag> : null}
        {data.output ? <NodeTag>output</NodeTag> : null}
        {data.definition.prompt_key ? (
          <NodeTag>prompt · {data.definition.prompt_key}</NodeTag>
        ) : null}
        {runtimePolicy ? (
          <>
            <NodeTag>external input</NodeTag>
            <NodeTag>source · {runtimePolicy.source}</NodeTag>
            <NodeTag>run {runtimePolicy.runtime_mode}</NodeTag>
            <NodeTag>eval {runtimePolicy.evaluation_mode}</NodeTag>
            {runtimePolicy.schema_version ? (
              <NodeTag>schema v{runtimePolicy.schema_version}</NodeTag>
            ) : null}
            {!runtimePolicy.required ? <NodeTag>conditional</NodeTag> : null}
          </>
        ) : null}
        {snapshotPolicy ? (
          <>
            <NodeTag>snapshot · {snapshotPolicy.output_key}</NodeTag>
            <NodeTag>{snapshotPolicy.binding_mode}</NodeTag>
            <NodeTag>
              {String(snapshotPolicy.snapshot_kind ?? "unknown").replaceAll(
                "_",
                " ",
              )}
            </NodeTag>
          </>
        ) : null}
        {resourcePolicy ? (
          <>
            <NodeTag>saved input: {resourcePolicy.resource_key}</NodeTag>
            <NodeTag>
              run{" "}
              {resourcePolicy.runtime_mode === "current" ? "latest" : "exact"}
            </NodeTag>
            <NodeTag>evaluation exact</NodeTag>
            <NodeTag>source: {resourcePolicy.producer_system_key}</NodeTag>
            <NodeTag>
              {String(
                resourcePolicy.producer_snapshot_kind ?? "unknown",
              ).replaceAll("_", " ")}
            </NodeTag>
            <NodeTag>schema v{resourcePolicy.schema_version}</NodeTag>
            {!resourcePolicy.required ? <NodeTag>optional</NodeTag> : null}
          </>
        ) : null}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!size-1.5 !border-0 !bg-[var(--border-strong)]"
      />
    </div>
  );
}

function NodeTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="mono bg-[var(--accent-soft)] px-1.5 py-1 text-[8px] text-[var(--accent)]">
      {children}
    </span>
  );
}
