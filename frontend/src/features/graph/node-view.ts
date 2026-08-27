import type {
  GraphNodeDefinition,
  NodeResourceSelection,
} from "@/lib/types";

/**
 * One vocabulary for graph nodes, shared by every screen that draws a graph.
 *
 * Screens differ in what they overlay on a node (a run selection, a trace
 * span), never in what a node is called or which colour it gets. Anything a
 * reader sees about a node — its type, its one-line summary, its badges, the
 * sentences describing where its data comes from — is decided here.
 */
export type GraphNodeType = "model" | "live" | "saved" | "logic";

export const graphNodeTypes: GraphNodeType[] = [
  "logic",
  "model",
  "live",
  "saved",
];

const typeLabels: Record<GraphNodeType, string> = {
  model: "Model",
  live: "Live data",
  saved: "Saved data",
  logic: "Logic",
};

const typeHints: Record<GraphNodeType, string> = {
  model: "Sends a prompt to the model",
  live: "Fetches data from outside the app",
  saved: "Reads data saved by an earlier run",
  logic: "Runs code, no model call",
};

export function graphNodeTypeLabel(type: GraphNodeType): string {
  return typeLabels[type];
}

export function graphNodeTypeHint(type: GraphNodeType): string {
  return typeHints[type];
}

/** CSS custom-property names for a node type's accent and fill. */
export function graphNodeTypeTokens(type: GraphNodeType): {
  accent: string;
  soft: string;
} {
  return { accent: `var(--node-${type})`, soft: `var(--node-${type}-soft)` };
}

export type GraphNodeFact = { label: string; value: string };

export type GraphNodeDataFlow = {
  reads: string | null;
  writes: string | null;
  onRun: string | null;
  onEvaluation: string | null;
};

export type GraphNodeView = {
  id: string;
  label: string;
  type: GraphNodeType;
  typeLabel: string;
  /** Short line under the node title. Never a sentence. */
  summary: string;
  badges: string[];
  facts: GraphNodeFact[];
  dataFlow: GraphNodeDataFlow;
  promptKey: string | null;
  ariaLabel: string;
  definition: GraphNodeDefinition;
};

export type GraphNodeViewOptions = {
  entry?: boolean;
  output?: boolean;
  /** The saved version a run has picked for this node, when one applies. */
  selection?: NodeResourceSelection;
  /** Node IDs this node feeds. */
  nextNodeIds?: string[];
};

export function graphNodeType(node: GraphNodeDefinition): GraphNodeType {
  if (node.kind === "llm") return "model";
  if (node.runtime_input_policy) return "live";
  if (node.resource_policy) return "saved";
  if (node.snapshot_policy?.binding_mode === "consume") return "saved";
  return "logic";
}

export function graphNodeView(
  node: GraphNodeDefinition,
  { entry, output, selection, nextNodeIds = [] }: GraphNodeViewOptions = {},
): GraphNodeView {
  const type = graphNodeType(node);
  const runtimePolicy = node.runtime_input_policy;
  const resourcePolicy = node.resource_policy;
  const snapshotPolicy = node.snapshot_policy;
  const saves =
    snapshotPolicy && snapshotPolicy.binding_mode !== "consume"
      ? snapshotPolicy.output_key
      : null;

  const badges = [
    entry ? "Start" : null,
    output ? "Result" : null,
    saves ? "Saves output" : null,
    isOptional(node) ? "Optional" : null,
  ].filter((badge): badge is string => Boolean(badge));

  const facts: GraphNodeFact[] = [
    { label: "Type", value: typeLabels[type] },
    { label: "Node", value: node.id },
  ];
  // Most handlers are named after their node; repeating that tells the reader nothing.
  if (node.handler !== node.id) {
    facts.push({ label: "Runs", value: node.handler });
  }
  if (node.prompt_key) facts.push({ label: "Prompt", value: node.prompt_key });
  if (runtimePolicy) facts.push({ label: "Source", value: runtimePolicy.source });
  if (resourcePolicy) {
    facts.push({ label: "Reads", value: resourcePolicy.resource_key });
    facts.push({
      label: "Saved by",
      value: `${resourcePolicy.producer_system_key} / ${resourcePolicy.producer_node_id}`,
    });
  }
  if (saves) facts.push({ label: "Saves", value: saves });
  if (selection) {
    facts.push({
      label: "Using",
      value:
        selection.mode === "current"
          ? `newest saved for ${selection.identity}`
          : "one exact saved version",
    });
  }
  if (nextNodeIds.length) {
    facts.push({ label: "Then", value: nextNodeIds.join(", ") });
  }

  const dataFlow = describeDataFlow(node, selection, saves);
  const summary = describeSummary(node, type);

  return {
    id: node.id,
    label: node.label,
    type,
    typeLabel: typeLabels[type],
    summary,
    badges,
    facts,
    dataFlow,
    promptKey: node.prompt_key ?? null,
    ariaLabel: [
      node.label,
      typeLabels[type],
      ...badges,
      ...facts
        .filter((fact) => fact.label !== "Type")
        .map((fact) => `${fact.label.toLowerCase()} ${fact.value}`),
    ].join(", "),
    definition: node,
  };
}

function isOptional(node: GraphNodeDefinition): boolean {
  if (node.runtime_input_policy) return !node.runtime_input_policy.required;
  if (node.resource_policy) return !node.resource_policy.required;
  if (node.snapshot_policy) return !node.snapshot_policy.required;
  return false;
}

function describeSummary(
  node: GraphNodeDefinition,
  type: GraphNodeType,
): string {
  if (type === "model") return node.prompt_key ?? node.handler;
  if (type === "live") return node.runtime_input_policy?.source ?? node.handler;
  if (type === "saved") {
    return (
      node.resource_policy?.resource_key ??
      node.snapshot_policy?.output_key ??
      node.handler
    );
  }
  return node.handler;
}

function describeDataFlow(
  node: GraphNodeDefinition,
  selection: NodeResourceSelection | undefined,
  saves: string | null,
): GraphNodeDataFlow {
  const runtimePolicy = node.runtime_input_policy;
  const resourcePolicy = node.resource_policy;
  const snapshotPolicy = node.snapshot_policy;

  if (runtimePolicy) {
    return {
      reads: `Live ${readable(runtimePolicy.source)} from outside the app.`,
      writes: saves ? `Keeps a copy as ${readable(saves)}.` : null,
      onRun:
        runtimePolicy.runtime_mode === "refresh"
          ? "Fetches new data."
          : "Reuses the last saved copy.",
      onEvaluation:
        runtimePolicy.evaluation_mode === "locked"
          ? "Reuses the copy pinned to each dataset example."
          : "Fetches new data.",
    };
  }

  if (resourcePolicy) {
    const mode = selection?.mode ?? resourcePolicy.runtime_mode;
    return {
      reads: `${capitalize(readable(resourcePolicy.resource_key))} saved by ${resourcePolicy.producer_system_key}.`,
      writes: saves ? `Keeps a copy as ${readable(saves)}.` : null,
      onRun:
        mode === "current"
          ? "Uses the newest saved version."
          : "Uses one exact saved version.",
      onEvaluation: "Uses the exact version pinned to each dataset example.",
    };
  }

  if (snapshotPolicy?.binding_mode === "consume") {
    return {
      reads: `${capitalize(readable(snapshotPolicy.output_key))} saved by an earlier run.`,
      writes: null,
      onRun: "Uses the newest saved version.",
      onEvaluation: "Uses the exact version pinned to each dataset example.",
    };
  }

  return {
    reads: null,
    writes: saves ? `Saves its output as ${readable(saves)}.` : null,
    onRun: null,
    onEvaluation: null,
  };
}

function readable(key: string): string {
  return key.replaceAll("_", " ");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
