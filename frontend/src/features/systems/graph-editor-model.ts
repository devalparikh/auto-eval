import type { GraphDefinition, GraphNodeDefinition } from "@/lib/types";

export type EditableGraphNode = GraphNodeDefinition & Record<string, unknown>;

export type EditableGraphDefinition = Omit<GraphDefinition, "nodes"> &
  Record<string, unknown> & {
    nodes: EditableGraphNode[];
  };

export type GraphValidationIssue = {
  path: string;
  message: string;
};

const identifierPattern = /^[a-z][a-z0-9_]{1,80}$/;
const promptKeyPattern = /^[a-z][a-z0-9-]{1,119}$/;

export function graphDefinitionFromSource(
  source: string,
):
  | { ok: true; definition: EditableGraphDefinition }
  | { ok: false; message: string } {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    return { ok: false, message: "Graph definition must be valid JSON." };
  }

  if (!isEditableGraphDefinition(value)) {
    return {
      ok: false,
      message:
        "Source must include entry_point, output_node, nodes, and edges.",
    };
  }
  return { ok: true, definition: value };
}

export function graphDefinitionToSource(
  definition: EditableGraphDefinition,
): string {
  return JSON.stringify(definition, null, 2);
}

export function validateGraphDefinition(
  definition: EditableGraphDefinition,
): GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const ids = new Set<string>();

  if (definition.nodes.length === 0) {
    issues.push({ path: "nodes", message: "Add at least one node." });
  } else if (definition.nodes.length > 80) {
    issues.push({
      path: "nodes",
      message: "Graphs can contain at most 80 nodes.",
    });
  }

  definition.nodes.forEach((node, index) => {
    const path = `nodes[${index}]`;
    if (!identifierPattern.test(node.id)) {
      issues.push({
        path: `${path}.id`,
        message:
          "Node IDs need 2–81 lowercase letters, numbers, or underscores.",
      });
    } else if (ids.has(node.id)) {
      issues.push({
        path: `${path}.id`,
        message: `Node ID “${node.id}” is duplicated.`,
      });
    }
    ids.add(node.id);

    if (!node.label.trim()) {
      issues.push({
        path: `${path}.label`,
        message: "Node labels cannot be empty.",
      });
    } else if (node.label.length > 120) {
      issues.push({
        path: `${path}.label`,
        message: "Node labels can contain at most 120 characters.",
      });
    }
    if (!identifierPattern.test(node.handler)) {
      issues.push({
        path: `${path}.handler`,
        message:
          "Handlers need 2–81 lowercase letters, numbers, or underscores.",
      });
    }
    if (node.task && node.task.length > 240) {
      issues.push({
        path: `${path}.task`,
        message: "Tasks can contain at most 240 characters.",
      });
    }
    if (node.prompt_key && !promptKeyPattern.test(node.prompt_key)) {
      issues.push({
        path: `${path}.prompt_key`,
        message:
          "Prompt keys need 2–120 lowercase letters, numbers, or hyphens.",
      });
    }
    if (node.kind !== "llm" && node.prompt_key != null) {
      issues.push({
        path: `${path}.prompt_key`,
        message: "Only model nodes can reference a prompt.",
      });
    }
    if (node.kind !== "deterministic" && node.snapshot_policy != null) {
      issues.push({
        path: `${path}.snapshot_policy`,
        message: "Only logic nodes can declare a snapshot policy.",
      });
    }
    if (node.kind !== "deterministic" && node.resource_policy != null) {
      issues.push({
        path: `${path}.resource_policy`,
        message: "Only logic nodes can declare a resource policy.",
      });
    }
  });

  if (!ids.has(definition.entry_point)) {
    issues.push({
      path: "entry_point",
      message: "Start must reference an existing node.",
    });
  }
  if (!ids.has(definition.output_node)) {
    issues.push({
      path: "output_node",
      message: "Result must reference an existing node.",
    });
  }
  if (definition.edges.length > 200) {
    issues.push({
      path: "edges",
      message: "Graphs can contain at most 200 edges.",
    });
  }

  const edgeKeys = new Set<string>();
  for (const [index, edge] of definition.edges.entries()) {
    const key = `${edge.source}\u0000${edge.target}`;
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      issues.push({
        path: `edges[${index}]`,
        message: `Edge ${edge.source} → ${edge.target} must reference existing nodes.`,
      });
    }
    if (edge.source === edge.target) {
      issues.push({
        path: `edges[${index}]`,
        message: "A node cannot connect to itself.",
      });
    }
    if (edgeKeys.has(key)) {
      issues.push({
        path: `edges[${index}]`,
        message: `Edge ${edge.source} → ${edge.target} is duplicated.`,
      });
    }
    edgeKeys.add(key);
  }

  if (
    !issues.some((issue) => issue.path.startsWith("edges")) &&
    hasCycle(definition)
  ) {
    issues.push({ path: "edges", message: "The graph must be acyclic." });
  }
  if (ids.has(definition.entry_point)) {
    const reached = new Set<string>();
    const pending = [definition.entry_point];
    while (pending.length) {
      const id = pending.pop()!;
      if (reached.has(id)) continue;
      reached.add(id);
      pending.push(
        ...definition.edges
          .filter((edge) => edge.source === id)
          .map((edge) => edge.target),
      );
    }
    const missing = definition.nodes.filter((node) => !reached.has(node.id));
    if (missing.length)
      issues.push({
        path: "edges",
        message: `Connect every node to Start: ${missing.map((node) => node.label).join(", ")}.`,
      });
  }
  if (definition.edges.some((edge) => edge.source === definition.output_node)) {
    issues.push({
      path: "output_node",
      message: "Result must be a final node with no outgoing edges.",
    });
  }
  return issues;
}

export function updateGraphNode(
  definition: EditableGraphDefinition,
  nodeId: string,
  patch: Partial<EditableGraphNode>,
): EditableGraphDefinition {
  const nextId = patch.id ?? nodeId;
  return {
    ...definition,
    entry_point:
      definition.entry_point === nodeId ? nextId : definition.entry_point,
    output_node:
      definition.output_node === nodeId ? nextId : definition.output_node,
    nodes: definition.nodes.map((node) =>
      node.id === nodeId ? { ...node, ...patch } : node,
    ),
    edges: definition.edges.map((edge) => ({
      ...edge,
      source: edge.source === nodeId ? nextId : edge.source,
      target: edge.target === nodeId ? nextId : edge.target,
    })),
  };
}

export function addGraphNode(
  definition: EditableGraphDefinition,
  kind: GraphNodeDefinition["kind"] = "deterministic",
  handler = kind === "llm" ? "llm_response" : "input",
): { definition: EditableGraphDefinition; nodeId: string } {
  const taken = new Set(definition.nodes.map((node) => node.id));
  let suffix = 1;
  let nodeId = "new_node";
  while (taken.has(nodeId)) {
    suffix += 1;
    nodeId = `new_node_${suffix}`;
  }
  return {
    nodeId,
    definition: {
      ...definition,
      nodes: [
        ...definition.nodes,
        {
          id: nodeId,
          label: "New node",
          kind,
          handler,
          task: null,
        },
      ],
      entry_point: definition.nodes.length ? definition.entry_point : nodeId,
      output_node: definition.nodes.length ? definition.output_node : nodeId,
    },
  };
}

export function removeGraphNode(
  definition: EditableGraphDefinition,
  nodeId: string,
): EditableGraphDefinition {
  const nodes = definition.nodes.filter((node) => node.id !== nodeId);
  const fallback = nodes[0]?.id ?? "";
  return {
    ...definition,
    nodes,
    edges: definition.edges.filter(
      (edge) => edge.source !== nodeId && edge.target !== nodeId,
    ),
    entry_point:
      definition.entry_point === nodeId ? fallback : definition.entry_point,
    output_node:
      definition.output_node === nodeId ? fallback : definition.output_node,
  };
}

export function addGraphEdge(
  definition: EditableGraphDefinition,
  source: string,
  target: string,
): EditableGraphDefinition {
  if (
    !source ||
    !target ||
    source === target ||
    definition.edges.some(
      (edge) => edge.source === source && edge.target === target,
    )
  ) {
    return definition;
  }
  return { ...definition, edges: [...definition.edges, { source, target }] };
}

export function removeGraphEdge(
  definition: EditableGraphDefinition,
  source: string,
  target: string,
): EditableGraphDefinition {
  return {
    ...definition,
    edges: definition.edges.filter(
      (edge) => edge.source !== source || edge.target !== target,
    ),
  };
}

function isEditableGraphDefinition(
  value: unknown,
): value is EditableGraphDefinition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.entry_point === "string" &&
    typeof candidate.output_node === "string" &&
    Array.isArray(candidate.nodes) &&
    candidate.nodes.every(isEditableGraphNode) &&
    Array.isArray(candidate.edges) &&
    candidate.edges.every(
      (edge) =>
        Boolean(edge) &&
        typeof edge === "object" &&
        typeof (edge as Record<string, unknown>).source === "string" &&
        typeof (edge as Record<string, unknown>).target === "string",
    )
  );
}

function isEditableGraphNode(value: unknown): value is EditableGraphNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  return (
    typeof node.id === "string" &&
    typeof node.label === "string" &&
    (node.kind === "deterministic" || node.kind === "llm") &&
    typeof node.handler === "string" &&
    (node.task == null || typeof node.task === "string") &&
    (node.prompt_key == null || typeof node.prompt_key === "string")
  );
}

function hasCycle(definition: EditableGraphDefinition): boolean {
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(definition.nodes.map((node) => [node.id, 0]));
  for (const edge of definition.edges) {
    outgoing.set(edge.source, [
      ...(outgoing.get(edge.source) ?? []),
      edge.target,
    ]);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }
  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift();
    if (!id) continue;
    visited += 1;
    for (const target of outgoing.get(id) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  return visited !== definition.nodes.length;
}
