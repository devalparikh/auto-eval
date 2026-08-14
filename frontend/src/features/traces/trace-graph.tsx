"use client";

import {
  BracketsCurlyIcon,
  CloudArrowDownIcon,
  DatabaseIcon,
  WaveformIcon,
} from "@phosphor-icons/react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useMemo } from "react";
import { GraphCanvas } from "@/components/graph-canvas";
import {
  buildTraceGraph,
  type TraceNodeData,
} from "@/features/traces/graph-layout";
import { formatCost, formatDuration } from "@/lib/format";
import type { Trace } from "@/lib/types";

const nodeTypes = { traceNode: TraceNode };
const traceFitOptions = { padding: 0.24, minZoom: 0.16, maxZoom: 1 };

export function TraceGraph({
  trace,
  selectedNodeId,
  onSelect,
}: {
  trace: Trace;
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const { nodes, edges } = useMemo(
    () => buildTraceGraph(trace, selectedNodeId),
    [selectedNodeId, trace],
  );

  return (
    <GraphCanvas
      ariaLabel="Trace execution graph"
      className="h-[420px] md:h-[520px]"
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitViewOptions={traceFitOptions}
      minZoom={0.16}
      maxZoom={1.4}
      elementsSelectable
      onNodeClick={(_, node) => onSelect(node.id)}
    />
  );
}

function TraceNode({ data }: NodeProps<Node<TraceNodeData>>) {
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
    <div
      className={`relative w-[208px] rounded-[2px] border bg-[var(--surface-raised)] p-3 shadow-[0_14px_40px_rgba(0,0,0,0.24)] transition-[border-color,transform,box-shadow] duration-150 ${
        data.selected
          ? "border-[var(--accent)] shadow-[0_0_0_1px_var(--accent),0_18px_45px_rgba(0,0,0,0.32)]"
          : "border-[var(--border-strong)]"
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-1.5 !border-0 !bg-[var(--border-strong)]"
      />
      <div className="flex items-center gap-2">
        <div
          className={`grid size-7 place-items-center rounded-[2px] border ${
            runtimePolicy || resourcePolicy || data.definition.kind === "llm"
              ? "border-[var(--accent)]/20 bg-[var(--accent-soft)] text-[var(--accent)]"
              : "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-muted)]"
          }`}
        >
          <Icon size={14} weight="bold" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold">
            {data.definition.label}
          </p>
          <p className="mono mt-0.5 text-[8px] tracking-[0.04em] text-[var(--text-faint)]">
            {runtimePolicy
              ? `external input · ${runtimePolicy.source}`
              : resourcePolicy
                ? `resource · ${resourcePolicy.resource_key}`
                : data.definition.kind}
          </p>
        </div>
      </div>
      {runtimePolicy ? (
        <div className="mono mt-2 flex flex-wrap gap-1 text-[8px] text-[var(--accent)]">
          <span className="bg-[var(--accent-soft)] px-1.5 py-1">
            run {runtimePolicy.runtime_mode}
          </span>
          <span className="bg-[var(--accent-soft)] px-1.5 py-1">
            eval {runtimePolicy.evaluation_mode}
          </span>
          {runtimePolicy.schema_version ? (
            <span className="bg-[var(--accent-soft)] px-1.5 py-1">
              schema v{runtimePolicy.schema_version}
            </span>
          ) : null}
          {!runtimePolicy.required ? (
            <span className="bg-[var(--accent-soft)] px-1.5 py-1">
              conditional
            </span>
          ) : null}
        </div>
      ) : null}
      {snapshotPolicy && !runtimePolicy ? (
        <div className="mono mt-2 flex flex-wrap gap-1 text-[8px] text-[var(--accent)]">
          <span className="bg-[var(--accent-soft)] px-1.5 py-1">
            snapshot · {snapshotPolicy.output_key}
          </span>
        </div>
      ) : null}
      {resourcePolicy ? (
        <div className="mono mt-2 flex flex-wrap gap-1 text-[8px] text-[var(--accent)]">
          <span className="bg-[var(--accent-soft)] px-1.5 py-1">
            resource · {resourcePolicy.resource_key}
          </span>
          <span className="bg-[var(--accent-soft)] px-1.5 py-1">
            run {resourcePolicy.runtime_mode}
          </span>
        </div>
      ) : null}
      {data.snapshotId || data.snapshotMode ? (
        <div className="mono mt-2 text-[8px] text-[var(--accent)]">
          <span className="bg-[var(--accent-soft)] px-1.5 py-1">
            {data.snapshotId
              ? `${data.snapshotRole ?? "used"} · ${data.snapshotMode ?? "snapshot"}`
              : `${data.snapshotMode ?? "computed"} · not captured`}
          </span>
        </div>
      ) : null}
      <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-2 text-[10px] text-[var(--text-muted)]">
        <span className="mono">{formatDuration(data.latency)}</span>
        <span className="mono">{formatCost(data.cost)}</span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!size-1.5 !border-0 !bg-[var(--border-strong)]"
      />
    </div>
  );
}
