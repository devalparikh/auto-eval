"use client";

import type { Node, NodeProps } from "@xyflow/react";
import { useMemo } from "react";
import { GraphCanvas, useIsGraphNodeSelected } from "@/components/graph-canvas";
import { StatusBadge } from "@/components/status-badge";
import { GraphLegend, GraphNodeCard } from "@/features/graph/graph-node-card";
import { graphHeightClass, graphRowCount } from "@/features/graph/layout";
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
    () => buildTraceGraph(trace),
    [trace],
  );
  const legendTypes = useMemo(
    () => nodes.map((node) => node.data.view.type),
    [nodes],
  );

  return (
    <div className="min-w-0">
      <div className="px-4 pb-2.5">
        <GraphLegend types={legendTypes} />
      </div>
      <GraphCanvas
        ariaLabel="Trace execution graph"
        className={graphHeightClass(graphRowCount(nodes))}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitViewOptions={traceFitOptions}
        minZoom={0.16}
        maxZoom={1.4}
        selectedNodeId={selectedNodeId}
        onSelectNode={onSelect}
      />
    </div>
  );
}

function TraceNode({ id, data }: NodeProps<Node<TraceNodeData>>) {
  const selected = useIsGraphNodeSelected(id);
  return (
    <GraphNodeCard
      view={data.view}
      selected={selected}
      width={208}
      footer={
        <div className="grid gap-2 text-[10px] text-[var(--text-muted)]">
          {data.dataLabel ? <span className="text-[10px] leading-4">{data.dataLabel}</span> : null}
          <div className="flex items-center justify-between gap-2">
          <StatusBadge status={data.status} />
          <span className="mono">{formatDuration(data.latency)}</span>
          <span className="mono">{formatCost(data.cost)}</span>
          </div>
        </div>
      }
    />
  );
}
