"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type CoordinateExtent,
  type Edge,
  type FitViewOptions,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useCallback, useEffect, useRef } from "react";

type GraphCanvasProps<NodeType extends Node> = {
  ariaLabel: string;
  className: string;
  nodes: NodeType[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  fitViewOptions: FitViewOptions<NodeType>;
  minZoom: number;
  maxZoom: number;
  elementsSelectable?: boolean;
  onNodeClick?: NodeMouseHandler<NodeType>;
  translateExtent?: CoordinateExtent;
  zoomOnScroll?: boolean;
};

export function GraphCanvas<NodeType extends Node>({
  ariaLabel,
  className,
  nodes,
  edges,
  nodeTypes,
  fitViewOptions,
  minZoom,
  maxZoom,
  elementsSelectable = false,
  onNodeClick,
  translateExtent,
  zoomOnScroll = false,
}: GraphCanvasProps<NodeType>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ReactFlowInstance<NodeType> | null>(null);
  const fitOptionsRef = useRef(fitViewOptions);
  const fitFrameRef = useRef<number | null>(null);
  const layoutSignature = nodes
    .map(
      (node) =>
        `${node.id}:${node.position.x}:${node.position.y}:${node.initialWidth ?? ""}:${node.initialHeight ?? ""}`,
    )
    .join("|");

  const scheduleFit = useCallback(() => {
    if (fitFrameRef.current !== null) {
      window.cancelAnimationFrame(fitFrameRef.current);
    }
    fitFrameRef.current = window.requestAnimationFrame(() => {
      fitFrameRef.current = null;
      const bounds = containerRef.current?.getBoundingClientRect();
      if (!bounds || bounds.width < 1 || bounds.height < 1) return;
      void instanceRef.current?.fitView(fitOptionsRef.current);
    });
  }, []);

  const initialize = useCallback(
    (instance: ReactFlowInstance<NodeType>) => {
      instanceRef.current = instance;
      scheduleFit();
    },
    [scheduleFit],
  );

  useEffect(() => {
    fitOptionsRef.current = fitViewOptions;
    scheduleFit();
  }, [fitViewOptions, scheduleFit]);

  useEffect(() => {
    scheduleFit();
  }, [layoutSignature, scheduleFit]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [scheduleFit]);

  useEffect(
    () => () => {
      if (fitFrameRef.current !== null) {
        window.cancelAnimationFrame(fitFrameRef.current);
      }
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      className={`min-w-0 w-full overflow-hidden bg-[var(--canvas)] ${className}`}
    >
      <ReactFlow<NodeType>
        aria-label={ariaLabel}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={elementsSelectable}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={minZoom}
        maxZoom={maxZoom}
        translateExtent={translateExtent}
        zoomOnScroll={zoomOnScroll}
        zoomOnDoubleClick={false}
        preventScrolling={zoomOnScroll}
        onInit={initialize}
        onNodeClick={onNodeClick}
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
          fitViewOptions={fitViewOptions}
          aria-label="Graph viewport controls"
          className="!overflow-hidden !rounded-[8px] !border-[var(--border-strong)] !bg-[var(--surface-raised)] !shadow-none"
        />
      </ReactFlow>
    </div>
  );
}
