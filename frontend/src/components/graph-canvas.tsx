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
  type NodeChange,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useReducedMotion } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

const RESIZE_FIT_DELAY_MS = 120;
const VIEW_MARGIN = 16;

const GraphSelectionContext = createContext<string | null>(null);

/**
 * Selection travels through context rather than node data. New node objects
 * make React Flow reset each node's measurements and handle positions, so a
 * click that rebuilt them would re-measure the whole graph and blink its edges.
 */
export const GraphSelectionProvider = GraphSelectionContext.Provider;

export function useIsGraphNodeSelected(nodeId: string): boolean {
  return useContext(GraphSelectionContext) === nodeId;
}

export function withActiveEdges(
  edges: Edge[],
  selectedNodeId: string | null | undefined,
): Edge[] {
  if (!selectedNodeId) return edges;
  return edges.map((edge) =>
    edge.source === selectedNodeId || edge.target === selectedNodeId
      ? { ...edge, className: "graph-edge-active" }
      : edge,
  );
}

type GraphCanvasProps<NodeType extends Node> = {
  ariaLabel: string;
  className: string;
  nodes: NodeType[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  fitViewOptions: FitViewOptions<NodeType>;
  minZoom: number;
  maxZoom: number;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
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
  selectedNodeId = null,
  onSelectNode,
  translateExtent,
  zoomOnScroll = false,
}: GraphCanvasProps<NodeType>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ReactFlowInstance<NodeType> | null>(null);
  const fitOptionsRef = useRef(fitViewOptions);
  const fitFrameRef = useRef<number | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const userMovedRef = useRef(false);
  const reduceMotion = useReducedMotion();
  const [measured, setMeasured] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const layoutSignature = nodes
    .map(
      (node) =>
        `${node.id}:${node.position.x}:${node.position.y}:${node.initialWidth ?? ""}:${node.initialHeight ?? ""}`,
    )
    .join("|");

  // A rebuilt definition or refreshed trace still produces new node objects.
  // Handing back the measurements keeps its edges in place while that happens.
  const flowNodes = useMemo(
    () =>
      nodes.map((node) =>
        measured[node.id] ? { ...node, measured: measured[node.id] } : node,
      ),
    [measured, nodes],
  );
  const flowEdges = useMemo(
    () => withActiveEdges(edges, selectedNodeId),
    [edges, selectedNodeId],
  );

  const handleNodesChange = useCallback((changes: NodeChange<NodeType>[]) => {
    const resized = changes.flatMap((change) =>
      change.type === "dimensions" && change.dimensions
        ? [[change.id, change.dimensions] as const]
        : [],
    );
    if (resized.length) {
      setMeasured((current) => ({
        ...current,
        ...Object.fromEntries(resized),
      }));
    }
  }, []);

  const scheduleFit = useCallback((duration?: number) => {
    if (fitFrameRef.current !== null) {
      window.cancelAnimationFrame(fitFrameRef.current);
    }
    fitFrameRef.current = window.requestAnimationFrame(() => {
      fitFrameRef.current = null;
      const bounds = containerRef.current?.getBoundingClientRect();
      if (!bounds || bounds.width < 1 || bounds.height < 1) return;
      void instanceRef.current?.fitView({
        ...fitOptionsRef.current,
        duration,
      });
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
    userMovedRef.current = false;
    scheduleFit();
  }, [layoutSignature, scheduleFit]);

  // Collapsing a sidebar resizes the canvas every frame for a quarter second.
  // Refit once it settles, and leave a view the user has moved alone.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (userMovedRef.current) return;
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null;
        scheduleFit(reduceMotion ? 0 : 200);
      }, RESIZE_FIT_DELAY_MS);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [reduceMotion, scheduleFit]);

  useEffect(
    () => () => {
      if (fitFrameRef.current !== null) {
        window.cancelAnimationFrame(fitFrameRef.current);
      }
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
    },
    [],
  );

  // A selection made from a list or a clipped edge should end up fully in view.
  useEffect(() => {
    const instance = instanceRef.current;
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!instance || !bounds || !selectedNodeId) return;
    const node = instance.getInternalNode(selectedNodeId);
    if (!node) return;
    const { x, y, zoom } = instance.getViewport();
    const width = node.measured.width ?? node.initialWidth ?? 0;
    const height = node.measured.height ?? node.initialHeight ?? 0;
    const { x: nodeX, y: nodeY } = node.internals.positionAbsolute;
    const left = nodeX * zoom + x;
    const top = nodeY * zoom + y;
    const inView =
      left >= VIEW_MARGIN &&
      top >= VIEW_MARGIN &&
      left + width * zoom <= bounds.width - VIEW_MARGIN &&
      top + height * zoom <= bounds.height - VIEW_MARGIN;
    if (inView) return;
    void instance.setCenter(nodeX + width / 2, nodeY + height / 2, {
      zoom,
      duration: reduceMotion ? 0 : 320,
    });
  }, [reduceMotion, selectedNodeId]);

  // React Flow's own Enter and Space handling only touches its internal
  // selection, which this canvas does not use.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!onSelectNode || (event.key !== "Enter" && event.key !== " ")) return;
    if (!(event.target instanceof Element)) return;
    const nodeId = event.target
      .closest(".react-flow__node")
      ?.getAttribute("data-id");
    if (!nodeId) return;
    event.preventDefault();
    onSelectNode(nodeId);
  }

  return (
    <div
      ref={containerRef}
      className={`graph-canvas min-w-0 w-full ${className}`}
      onKeyDown={handleKeyDown}
    >
      <GraphSelectionProvider value={selectedNodeId}>
        <ReactFlow<NodeType>
          aria-label={ariaLabel}
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          elementsSelectable={Boolean(onSelectNode)}
          fitView
          fitViewOptions={fitViewOptions}
          minZoom={minZoom}
          maxZoom={maxZoom}
          translateExtent={translateExtent}
          zoomOnScroll={zoomOnScroll}
          zoomOnDoubleClick={false}
          preventScrolling={zoomOnScroll}
          onInit={initialize}
          onNodesChange={handleNodesChange}
          onNodeClick={
            onSelectNode ? (_, node) => onSelectNode(node.id) : undefined
          }
          onMoveStart={(event) => {
            if (event) userMovedRef.current = true;
          }}
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
            onFitView={() => {
              userMovedRef.current = false;
            }}
            aria-label="Graph viewport controls"
            className="!overflow-hidden !rounded-[10px] !border-0 !bg-[var(--surface-raised)] !shadow-none"
          />
        </ReactFlow>
      </GraphSelectionProvider>
    </div>
  );
}
