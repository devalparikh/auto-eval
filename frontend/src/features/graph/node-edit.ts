import type { GraphDefinition, GraphNodeDefinition } from "@/lib/types";

/**
 * What a reader may change about a node from the graph itself.
 *
 * Today exactly one setting is editable: where a live-data node gets its data
 * on a run. The set of settings is data — `fieldSpecs` — so a second one is an
 * entry in that list rather than a new shape for the callers, which only ever
 * ask "what can I change here", "apply this", and "what did I change".
 *
 * Nothing here mutates: an edit returns a new definition, and the definition it
 * was given is left exactly as it was so the saved version stays comparable.
 */

export type NodeEditFieldKey = "live_data_run_behaviour";

export type NodeEditChoice = {
  value: string;
  /** The choice itself, as the reader picks it. */
  label: string;
  /** What picking it does to their runs. One sentence. */
  hint: string;
};

export type NodeEditField = {
  key: NodeEditFieldKey;
  nodeId: string;
  /** Heading above the choices. */
  label: string;
  /** What this setting covers, and what it leaves alone. */
  description: string;
  choices: NodeEditChoice[];
  /** The choice this node currently sits on. */
  value: string;
};

export type NodeEdit = {
  nodeId: string;
  field: NodeEditFieldKey;
  value: string;
};

export type GraphDraftChange = {
  nodeId: string;
  field: NodeEditFieldKey;
  /** One line the reader can check before saving. */
  summary: string;
};

type FieldSpec = {
  key: NodeEditFieldKey;
  label: string;
  choices: NodeEditChoice[];
  /** The node's current choice, or null when the setting does not apply to it. */
  read: (node: GraphNodeDefinition) => string | null;
  describe: (node: GraphNodeDefinition) => string;
  write: (node: GraphNodeDefinition, value: string) => GraphNodeDefinition;
  /** What moving between two choices does, in the reader's words. */
  changeSummary: (from: string, to: string) => string | null;
};

const liveDataRunBehaviour: FieldSpec = {
  key: "live_data_run_behaviour",
  label: "Where this node gets its data",
  choices: [
    {
      value: "refresh",
      label: "Fetch new data each run",
      hint: "Every run goes out and gets the data as it stands right then.",
    },
    {
      value: "locked",
      label: "Use a saved snapshot",
      hint: "Runs reuse data that was saved earlier. You choose which snapshot on the run page.",
    },
  ],
  read: (node) => node.runtime_input_policy?.runtime_mode ?? null,
  describe: (node) =>
    node.runtime_input_policy?.evaluation_mode === "locked"
      ? "Applies to runs you start yourself. Evaluations always use the data saved with each example, either way."
      : "Applies to runs you start yourself.",
  write: (node, value) => {
    const policy = node.runtime_input_policy;
    if (!policy) return node;
    if (value !== "refresh" && value !== "locked") return node;
    if (policy.runtime_mode === value) return node;
    return {
      ...node,
      runtime_input_policy: { ...policy, runtime_mode: value },
    };
  },
  changeSummary: (from, to) => {
    if (from === to) return null;
    return to === "locked"
      ? "now uses a saved snapshot instead of fetching new data"
      : "now fetches new data instead of using a saved snapshot";
  },
};

const fieldSpecs: FieldSpec[] = [liveDataRunBehaviour];

/** Every setting this node exposes, ready to render as a group of choices. */
export function editableNodeFields(node: GraphNodeDefinition): NodeEditField[] {
  return fieldSpecs.flatMap((spec) => {
    const value = spec.read(node);
    if (value === null) return [];
    return [
      {
        key: spec.key,
        nodeId: node.id,
        label: spec.label,
        description: spec.describe(node),
        choices: spec.choices,
        value,
      },
    ];
  });
}

export function isNodeEditable(node: GraphNodeDefinition): boolean {
  return fieldSpecs.some((spec) => spec.read(node) !== null);
}

/**
 * A new definition with one setting changed. The original is never touched, and
 * keys this app does not model — a node's response schema, say — ride along.
 */
export function applyNodeEdit(
  definition: GraphDefinition,
  edit: NodeEdit,
): GraphDefinition {
  const spec = fieldSpecs.find((candidate) => candidate.key === edit.field);
  if (!spec) return definition;
  let changed = false;
  const nodes = definition.nodes.map((node) => {
    if (node.id !== edit.nodeId) return node;
    if (spec.read(node) === null) return node;
    const next = spec.write(node, edit.value);
    if (next !== node) changed = true;
    return next;
  });
  return changed ? { ...definition, nodes } : definition;
}

export function graphDraftChanged(
  original: GraphDefinition,
  draft: GraphDefinition,
): boolean {
  return !sameValue(original, draft);
}

/**
 * The edits between two definitions, one line each. Only recognised settings
 * appear: a hand-edited definition can differ in ways this cannot narrate, and
 * `graphDraftChanged` is what tells a caller that happened.
 */
export function graphDraftChanges(
  original: GraphDefinition,
  draft: GraphDefinition,
): GraphDraftChange[] {
  const before = new Map(original.nodes.map((node) => [node.id, node]));
  return draft.nodes.flatMap((node) => {
    const previous = before.get(node.id);
    if (!previous) return [];
    return fieldSpecs.flatMap((spec) => {
      const from = spec.read(previous);
      const to = spec.read(node);
      if (from === null || to === null) return [];
      const summary = spec.changeSummary(from, to);
      if (!summary) return [];
      return [
        { nodeId: node.id, field: spec.key, summary: `${node.label} — ${summary}` },
      ];
    });
  });
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return (
      left.length === right.length &&
      left.every((item, index) => sameValue(item, right[index]))
    );
  }
  if (
    typeof left !== "object" ||
    typeof right !== "object" ||
    left === null ||
    right === null
  ) {
    return false;
  }
  const leftEntries = Object.entries(left as Record<string, unknown>);
  const rightRecord = right as Record<string, unknown>;
  return (
    leftEntries.length === Object.keys(rightRecord).length &&
    leftEntries.every(
      ([key, value]) =>
        Object.hasOwn(rightRecord, key) && sameValue(value, rightRecord[key]),
    )
  );
}
