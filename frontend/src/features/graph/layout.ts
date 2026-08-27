import type { GraphNodeDefinition } from "@/lib/types";

/**
 * Longest-path depth per node, so every graph screen stacks the same nodes into
 * the same left-to-right columns.
 */
export function graphLevels(
  nodes: GraphNodeDefinition[],
  edges: Array<{ source: string; target: string }>,
): Map<string, number> {
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));

  edges.forEach((edge) => {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  });

  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  const levels = new Map(queue.map((id) => [id, 0]));

  while (queue.length) {
    const source = queue.shift();
    if (!source) break;
    for (const target of outgoing.get(source) ?? []) {
      const nextLevel = (levels.get(source) ?? 0) + 1;
      levels.set(target, Math.max(levels.get(target) ?? 0, nextLevel));
      incoming.set(target, (incoming.get(target) ?? 1) - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }

  return levels;
}
