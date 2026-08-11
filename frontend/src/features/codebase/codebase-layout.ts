import type { Edge, Node, Viewport, XYPosition } from "@xyflow/react";
import type {
  CodebaseChangeStatus,
  CodebaseEdge,
  CodebaseEdgeKind,
  CodebaseGraph,
  CodebaseMode,
  CodebaseNode,
} from "@/lib/types";

export type SemanticLevel = 0 | 1 | 2 | 3;

export type CodebaseFlowNodeData = CodebaseNode & {
  childCount: number;
  selected: boolean;
  focused: boolean;
  entering: boolean;
};

type Position = { x: number; y: number };

const ENTER_THRESHOLDS = [0.9, 1.25, 1.72] as const;
const EXIT_THRESHOLDS = [0.82, 1.14, 1.56] as const;
const DEPTH_X = [0, 310, 600, 870] as const;
const DEPTH_STEP = [112, 82, 76, 54] as const;
const NODE_WIDTH = [248, 196, 204, 154] as const;
const NODE_HEIGHT = [82, 62, 62, 40] as const;

export function semanticLevelForZoom(
  zoom: number,
  current?: SemanticLevel,
): SemanticLevel {
  if (current === undefined) {
    if (zoom < ENTER_THRESHOLDS[0]) return 0;
    if (zoom < ENTER_THRESHOLDS[1]) return 1;
    if (zoom < ENTER_THRESHOLDS[2]) return 2;
    return 3;
  }
  let next = current;
  while (next < 3) {
    const threshold = ENTER_THRESHOLDS[next as 0 | 1 | 2];
    if (zoom < threshold) break;
    next += 1;
  }
  while (next > 0) {
    const threshold = EXIT_THRESHOLDS[(next - 1) as 0 | 1 | 2];
    if (zoom >= threshold) break;
    next -= 1;
  }
  return next as SemanticLevel;
}

export function semanticLevelLabel(
  level: SemanticLevel,
  mode: CodebaseMode = "files",
): string {
  const labels =
    mode === "logic"
      ? ["Systems", "Domains", "Capabilities", "Components"]
      : ["Areas", "Modules", "Files", "Symbols"];
  return labels[level];
}

export function buildCodebaseFlow(
  graph: CodebaseGraph,
  level: SemanticLevel,
  selectedNodeId: string | null,
  requestedFocusNodeId: string | null = null,
): {
  nodes: Node<CodebaseFlowNodeData>[];
  edges: Edge[];
  focusNodeId: string | null;
} {
  const focusNodeId = resolveFocusNode(
    graph.nodes,
    level,
    requestedFocusNodeId ?? selectedNodeId,
  );
  const focusPath = ancestorPath(focusNodeId, graph.nodes);
  const visible = visibleNodes(graph.nodes, level, focusPath);
  const visibleIds = new Set(visible.map((node) => node.id));
  const positions = layoutPositions(visible, level, focusPath);
  const childCounts = countChildren(graph.nodes);
  const nodes: Node<CodebaseFlowNodeData>[] = visible.map((node) => ({
    id: node.id,
    type: "codebaseNode",
    position: positions.get(node.id) ?? { x: 0, y: 0 },
    ariaLabel: `${node.label}, ${node.kind}, ${node.status}`,
    data: {
      ...node,
      childCount: childCounts.get(node.id) ?? 0,
      selected: selectedNodeId === node.id,
      focused: focusPath.get(node.detail_level) === node.id,
      entering: level > 0 && node.detail_level === level,
    },
  }));

  const contains = graph.edges
    .filter(
      (edge) =>
        edge.kind === "contains" &&
        visibleIds.has(edge.source) &&
        visibleIds.has(edge.target),
    )
    .map(flowEdge);
  const dependencies = aggregateDependencyEdges(graph, level, visibleIds).map(flowEdge);
  return { nodes, edges: [...contains, ...dependencies], focusNodeId };
}

export function focusNodeForLevel(
  nodes: CodebaseNode[],
  level: SemanticLevel,
  candidateId: string | null,
): string | null {
  return resolveFocusNode(nodes, level, candidateId);
}

export function closestNodeAtLevel(
  nodes: Node<CodebaseFlowNodeData>[],
  point: XYPosition,
  detailLevel: number,
): string | null {
  let closest: { id: string; distance: number } | null = null;
  for (const node of nodes) {
    if (node.data.detail_level !== detailLevel) continue;
    const center = flowNodeCenter(node);
    const distance = Math.hypot(center.x - point.x, center.y - point.y);
    if (!closest || distance < closest.distance) {
      closest = { id: node.id, distance };
    }
  }
  return closest?.id ?? null;
}

export function anchoredViewport(
  node: Node<CodebaseFlowNodeData>,
  screenAnchor: XYPosition,
  zoom: number,
): Viewport {
  const center = flowNodeCenter(node);
  return {
    x: screenAnchor.x - center.x * zoom,
    y: screenAnchor.y - center.y * zoom,
    zoom,
  };
}

function resolveFocusNode(
  nodes: CodebaseNode[],
  level: SemanticLevel,
  candidateId: string | null,
): string | null {
  if (level === 0) return null;
  const targetLevel = level - 1;
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  let candidate = candidateId ? nodesById.get(candidateId) : undefined;
  while (candidate && candidate.detail_level > targetLevel) {
    candidate = candidate.parent_id
      ? nodesById.get(candidate.parent_id)
      : undefined;
  }
  if (candidate && candidate.detail_level === targetLevel) return candidate.id;

  const descendants = nodes.filter(
    (node) =>
      node.detail_level === targetLevel &&
      (!candidate || isDescendantOf(node, candidate.id, nodesById)),
  );
  return (
    descendants.find((node) => node.status !== "unchanged")?.id ??
    descendants[0]?.id ??
    null
  );
}

function visibleNodes(
  nodes: CodebaseNode[],
  level: SemanticLevel,
  focusPath: Map<number, string>,
): CodebaseNode[] {
  if (level === 0) return nodes.filter((node) => node.detail_level === 0);
  const visible = nodes.filter((node) => {
    if (node.detail_level === 0) return true;
    if (node.detail_level > level) return false;
    return node.parent_id === focusPath.get(node.detail_level - 1);
  });
  return visible.sort(
    (left, right) =>
      left.detail_level - right.detail_level || left.path.localeCompare(right.path),
  );
}

function layoutPositions(
  nodes: CodebaseNode[],
  level: SemanticLevel,
  focusPath: Map<number, string>,
): Map<string, Position> {
  if (level === 0) return overviewPositions(nodes);
  const positions = new Map<string, Position>();
  for (let depth = 0; depth <= level; depth += 1) {
    const items = nodes.filter((node) => node.detail_level === depth);
    const focusId = focusPath.get(depth);
    const focusIndex = Math.max(
      0,
      focusId ? items.findIndex((node) => node.id === focusId) : 0,
    );
    const center = focusId ? focusIndex : (items.length - 1) / 2;
    items.forEach((node, index) => {
      positions.set(node.id, {
        x: DEPTH_X[depth],
        y: (index - center) * DEPTH_STEP[depth],
      });
    });
  }
  return positions;
}

function overviewPositions(nodes: CodebaseNode[]): Map<string, Position> {
  const roots = nodes
    .filter((node) => node.detail_level === 0)
    .sort((left, right) => left.path.localeCompare(right.path));
  return new Map(
    roots.map((node, index) => [
      node.id,
      { x: (index % 3) * 350, y: Math.floor(index / 3) * 170 },
    ]),
  );
}

function ancestorPath(
  nodeId: string | null,
  nodes: CodebaseNode[],
): Map<number, string> {
  const path = new Map<number, string>();
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  let node = nodeId ? nodesById.get(nodeId) : undefined;
  while (node) {
    path.set(node.detail_level, node.id);
    node = node.parent_id ? nodesById.get(node.parent_id) : undefined;
  }
  return path;
}

function isDescendantOf(
  node: CodebaseNode,
  ancestorId: string,
  nodesById: Map<string, CodebaseNode>,
): boolean {
  let current: CodebaseNode | undefined = node;
  while (current?.parent_id) {
    if (current.parent_id === ancestorId) return true;
    current = nodesById.get(current.parent_id);
  }
  return false;
}

function countChildren(nodes: CodebaseNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  nodes.forEach((node) => {
    if (node.parent_id)
      counts.set(node.parent_id, (counts.get(node.parent_id) ?? 0) + 1);
  });
  return counts;
}

function aggregateDependencyEdges(
  graph: CodebaseGraph,
  level: SemanticLevel,
  visibleIds: Set<string>,
): CodebaseEdge[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const aggregated = new Map<string, CodebaseEdge>();
  for (const edge of graph.edges) {
    if (edge.kind === "contains") continue;
    const source = visibleAncestor(edge.source, visibleIds, nodesById);
    const target = visibleAncestor(edge.target, visibleIds, nodesById);
    if (!source || !target || source === target) continue;
    const key = `${edge.kind}:${source}:${target}`;
    const existing = aggregated.get(key);
    aggregated.set(key, {
      id: `dependency:${key}`,
      source,
      target,
      kind: edge.kind,
      status: mergeStatus(existing?.status, edge.status),
      label: existing?.label ?? edge.label,
    });
  }
  const edges = [...aggregated.values()];
  if (graph.comparison.source !== "current" && level < 2) {
    return edges.filter((edge) => edge.status !== "unchanged");
  }
  return edges;
}

function visibleAncestor(
  nodeId: string,
  visibleIds: Set<string>,
  nodesById: Map<string, CodebaseNode>,
): string | null {
  let node = nodesById.get(nodeId);
  while (node) {
    if (visibleIds.has(node.id)) return node.id;
    node = node.parent_id ? nodesById.get(node.parent_id) : undefined;
  }
  return null;
}

function mergeStatus(
  current: CodebaseChangeStatus | undefined,
  next: CodebaseChangeStatus,
): CodebaseChangeStatus {
  if (!current) return next;
  if (current === next) return current;
  if (current === "unchanged") return next;
  if (next === "unchanged") return current;
  return "modified";
}

function flowEdge(edge: CodebaseEdge): Edge {
  const changed = edge.status !== "unchanged";
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.kind === "contains" ? "smoothstep" : "default",
    animated: changed && edge.kind !== "contains",
    className: `codebase-edge codebase-edge-${edge.kind} change-${edge.status}`,
    style: {
      stroke: edgeColor(edge.status, edge.kind),
      strokeWidth: changed ? 1.8 : edge.kind === "contains" ? 1 : 1.2,
      opacity: edge.kind === "contains" ? 0.52 : 0.76,
    },
  };
}

function edgeColor(
  status: CodebaseChangeStatus,
  kind: CodebaseEdgeKind,
): string {
  if (status === "added") return "var(--success)";
  if (status === "removed") return "var(--danger)";
  if (status === "modified" || status === "renamed") return "var(--warning)";
  return kind === "contains" ? "var(--border)" : "var(--border-strong)";
}

function flowNodeCenter(node: Node<CodebaseFlowNodeData>): XYPosition {
  const depth = Math.min(3, Math.max(0, node.data.detail_level));
  return {
    x: node.position.x + NODE_WIDTH[depth] / 2,
    y: node.position.y + NODE_HEIGHT[depth] / 2,
  };
}
