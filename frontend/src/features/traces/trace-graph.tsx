"use client";

import { BracketsCurlyIcon, SparkleIcon } from "@phosphor-icons/react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useMemo } from "react";
import {
  buildTraceGraph,
  type TraceNodeData,
} from "@/features/traces/graph-layout";
import { formatCost, formatDuration } from "@/lib/format";
import type { Trace } from "@/lib/types";

const nodeTypes = { traceNode: TraceNode };

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
    <div className="h-[420px] w-full bg-[var(--surface)] md:h-[520px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.24 }}
        minZoom={0.55}
        maxZoom={1.4}
        onNodeClick={(_, node) => onSelect(node.id)}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color="var(--border-strong)"
        />
        <Controls
          showInteractive={false}
          className="!overflow-hidden !rounded-[8px] !border-[var(--border)] !bg-[var(--surface-raised)] !shadow-none"
        />
      </ReactFlow>
    </div>
  );
}

function TraceNode({ data }: NodeProps<Node<TraceNodeData>>) {
  const Icon = data.definition.kind === "llm" ? SparkleIcon : BracketsCurlyIcon;
  return (
    <div
      className={`w-[208px] rounded-[10px] border bg-[var(--surface-raised)] p-3 shadow-[0_10px_30px_rgba(20,33,45,0.08)] transition-[border-color,transform] duration-150 ${
        data.selected ? "border-[var(--accent)]" : "border-[var(--border-strong)]"
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2 !border-0 !bg-[var(--border-strong)]"
      />
      <div className="flex items-center gap-2">
        <div
          className={`grid size-7 place-items-center rounded-[7px] ${
            data.definition.kind === "llm"
              ? "bg-[var(--accent-soft)] text-[var(--accent)]"
              : "bg-[var(--surface-muted)] text-[var(--text-muted)]"
          }`}
        >
          <Icon size={14} weight="bold" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold">{data.definition.label}</p>
          <p className="mono text-[9px] text-[var(--text-faint)]">
            {data.definition.kind}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-2 text-[10px] text-[var(--text-muted)]">
        <span className="mono">{formatDuration(data.latency)}</span>
        <span className="mono">{formatCost(data.cost)}</span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!size-2 !border-0 !bg-[var(--border-strong)]"
      />
    </div>
  );
}
