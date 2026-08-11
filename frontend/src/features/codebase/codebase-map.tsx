"use client";

import {
  ArrowsOutIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
} from "@phosphor-icons/react";
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  type Edge,
  type Node,
  ReactFlow,
  type OnMove,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  anchoredViewport,
  buildCodebaseFlow,
  closestNodeAtLevel,
  focusNodeForLevel,
  semanticLevelForZoom,
  semanticLevelLabel,
  type CodebaseFlowNodeData,
  type SemanticLevel,
} from "@/features/codebase/codebase-layout";
import { CodebaseMapNode } from "@/features/codebase/codebase-node";
import type { CodebaseGraph, CodebaseNode } from "@/lib/types";

const nodeTypes = { codebaseNode: CodebaseMapNode };
const DEFAULT_VIEWPORT = { x: 72, y: 84, zoom: 0.72 };
const VIEWPORT_DURATION = 420;

type FlowInstance = ReactFlowInstance<Node<CodebaseFlowNodeData>, Edge>;

export function CodebaseMap({
  graph,
  selectedNodeId,
  onSelect,
}: {
  graph: CodebaseGraph;
  selectedNodeId: string | null;
  onSelect: (nodeId: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const levelRef = useRef<SemanticLevel>(0);
  const transitionTimerRef = useRef<number | null>(null);
  const pendingAnchorRef = useRef<{
    nodeId: string;
    screen: { x: number; y: number };
    zoom: number;
  } | null>(null);
  const [instance, setInstance] = useState<FlowInstance | null>(null);
  const [level, setLevel] = useState<SemanticLevel>(0);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const flow = useMemo(
    () => buildCodebaseFlow(graph, level, selectedNodeId, focusNodeId),
    [focusNodeId, graph, level, selectedNodeId],
  );

  const startTransition = useCallback(() => {
    setTransitioning(false);
    window.requestAnimationFrame(() => setTransitioning(true));
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
    }
    transitionTimerRef.current = window.setTimeout(
      () => setTransitioning(false),
      VIEWPORT_DURATION + 80,
    );
  }, []);

  const handleMove = useCallback<OnMove>(
    (event, viewport) => {
      const currentLevel = levelRef.current;
      const nextLevel = semanticLevelForZoom(viewport.zoom, currentLevel);
      if (nextLevel === currentLevel || !instance || !containerRef.current) return;

      const bounds = containerRef.current.getBoundingClientRect();
      const eventPosition = pointerPosition(event);
      const screen = eventPosition
        ? { x: eventPosition.x - bounds.left, y: eventPosition.y - bounds.top }
        : { x: bounds.width / 2, y: bounds.height / 2 };
      const absoluteScreen = { x: screen.x + bounds.left, y: screen.y + bounds.top };
      const flowPoint = instance.screenToFlowPosition(absoluteScreen);
      const anchorLevel = Math.max(0, nextLevel - 1);
      const nearestNodeId = closestNodeAtLevel(
        flow.nodes,
        flowPoint,
        anchorLevel,
      );
      const requestedAnchorId = eventPosition
        ? nearestNodeId ?? flow.focusNodeId ?? selectedNodeId
        : selectedNodeId ?? flow.focusNodeId ?? nearestNodeId;
      const anchorNodeId =
        nextLevel === 0
          ? nearestNodeId ?? requestedAnchorId
          : focusNodeForLevel(graph.nodes, nextLevel, requestedAnchorId);

      if (anchorNodeId) {
        pendingAnchorRef.current = {
          nodeId: anchorNodeId,
          screen,
          zoom: viewport.zoom,
        };
      }
      levelRef.current = nextLevel;
      setLevel(nextLevel);
      setFocusNodeId(nextLevel === 0 ? null : anchorNodeId);
      startTransition();
    },
    [
      flow.focusNodeId,
      flow.nodes,
      graph.nodes,
      instance,
      selectedNodeId,
      startTransition,
    ],
  );

  useEffect(() => {
    const pending = pendingAnchorRef.current;
    if (!pending || !instance) return;
    const anchor = flow.nodes.find((node) => node.id === pending.nodeId);
    if (!anchor) return;
    pendingAnchorRef.current = null;
    const viewport = anchoredViewport(anchor, pending.screen, pending.zoom);
    window.requestAnimationFrame(() => {
      void instance.setViewport(viewport, {
        duration: VIEWPORT_DURATION,
        ease: easeInOutCubic,
      });
    });
  }, [flow.nodes, instance]);

  useEffect(
    () => () => {
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
      }
    },
    [],
  );

  const levelLabel = semanticLevelLabel(level, graph.mode);
  return (
    <div
      ref={containerRef}
      className={`codebase-map ${transitioning ? "is-semantic-transition" : ""}`}
      data-semantic-level={level}
      data-map-mode={graph.mode}
    >
      <div className="codebase-map-level" aria-live="polite">
        <span>{levelLabel}</span>
        <small>{nextLevelHint(level, graph)}</small>
      </div>
      <div className="codebase-map-legend" aria-label="Diff legend">
        <LegendItem status="added" label="Added" />
        <LegendItem status="modified" label="Changed" />
        <LegendItem status="removed" label="Removed" />
      </div>
      <ReactFlow
        aria-label={`Codebase graph at ${levelLabel} detail`}
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onlyRenderVisibleElements
        minZoom={0.45}
        maxZoom={2.4}
        defaultViewport={DEFAULT_VIEWPORT}
        onInit={setInstance}
        onMove={handleMove}
        onNodeClick={(_, node) => {
          setFocusNodeId(node.id);
          onSelect(node.id);
        }}
        onPaneClick={() => onSelect(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="var(--border-strong)"
        />
        <MiniMap
          ariaLabel="Codebase overview"
          className="codebase-minimap"
          maskColor="var(--code-map-mask)"
          nodeColor={miniMapColor}
          nodeStrokeWidth={2}
          pannable
          zoomable
        />
        <Controls
          showZoom={false}
          showFitView={false}
          showInteractive={false}
          className="!overflow-hidden !rounded-[2px] !border-[var(--border-strong)] !bg-[var(--surface-raised)] !shadow-none"
        >
          <ControlButton
            title="Zoom in"
            aria-label="Zoom in"
            onClick={() =>
              void instance?.zoomIn({
                duration: VIEWPORT_DURATION,
                ease: easeInOutCubic,
              })
            }
          >
            <MagnifyingGlassPlusIcon size={14} />
          </ControlButton>
          <ControlButton
            title="Zoom out"
            aria-label="Zoom out"
            onClick={() =>
              void instance?.zoomOut({
                duration: VIEWPORT_DURATION,
                ease: easeInOutCubic,
              })
            }
          >
            <MagnifyingGlassMinusIcon size={14} />
          </ControlButton>
          <ControlButton
            title="Fit visible scope"
            aria-label="Fit visible scope"
            onClick={() =>
              void instance?.fitView({
                nodes: flow.nodes,
                padding: 0.18,
                duration: VIEWPORT_DURATION,
                ease: easeInOutCubic,
              })
            }
          >
            <ArrowsOutIcon size={14} />
          </ControlButton>
        </Controls>
      </ReactFlow>
    </div>
  );
}

function LegendItem({ status, label }: { status: string; label: string }) {
  return (
    <span>
      <i className={`change-${status}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function nextLevelHint(level: SemanticLevel, graph: CodebaseGraph): string {
  if (level === 3) return "maximum fidelity";
  return `zoom in for ${semanticLevelLabel((level + 1) as SemanticLevel, graph.mode).toLowerCase()}`;
}

function miniMapColor(node: { data: unknown }): string {
  const data = node.data as CodebaseNode;
  if (data.status === "added") return "var(--success)";
  if (data.status === "removed") return "var(--danger)";
  if (data.status === "modified" || data.status === "renamed")
    return "var(--warning)";
  return data.detail_level === 0 ? "var(--accent)" : "var(--border-strong)";
}

function easeInOutCubic(value: number): number {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function pointerPosition(
  event: MouseEvent | TouchEvent | null,
): { x: number; y: number } | null {
  if (!event) return null;
  if ("clientX" in event) return { x: event.clientX, y: event.clientY };
  const touch = event.touches[0] ?? event.changedTouches[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}
