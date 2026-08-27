import type {
  GraphNodeDefinition,
  NodeResourceSelection,
  NodeSnapshotSummary,
} from "@/lib/types";

export type SavedInputChoice = {
  token: string;
  label: string;
  description: string;
  selection: NodeResourceSelection;
  snapshot: NodeSnapshotSummary | null;
};

export function snapshotsForSavedInputNode(
  node: GraphNodeDefinition,
  snapshots: NodeSnapshotSummary[],
): NodeSnapshotSummary[] {
  const policy = node.resource_policy;
  if (!policy) return [];
  return snapshots
    .filter(
      (snapshot) =>
        snapshot.product_key === policy.product_key &&
        snapshot.agent_system_key === policy.producer_system_key &&
        snapshot.node_id === policy.producer_node_id &&
        snapshot.output_key === policy.producer_output_key &&
        snapshot.snapshot_kind === policy.producer_snapshot_kind &&
        snapshot.schema_version === policy.schema_version &&
        Boolean(snapshot.resource_identity),
    )
    .sort(
      (left, right) =>
        new Date(right.observed_at).getTime() -
        new Date(left.observed_at).getTime(),
    );
}

export function savedInputChoicesForNode(
  node: GraphNodeDefinition,
  latestSnapshots: NodeSnapshotSummary[],
  exactSnapshots: NodeSnapshotSummary[] = latestSnapshots,
): SavedInputChoice[] {
  const latest = snapshotsForSavedInputNode(node, latestSnapshots);
  const exact = snapshotsForSavedInputNode(node, exactSnapshots);
  const identities = [
    ...new Set(
      latest
        .map((snapshot) => snapshot.resource_identity)
        .filter((identity): identity is string => Boolean(identity)),
    ),
  ];
  const latestChoices = identities.map((identity) => ({
    token: `current:${identity}`,
    label: `Latest: ${humanizeIdentity(identity)}`,
    description: "Uses the newest saved version available when the run starts",
    selection: { mode: "current", identity } as const,
    snapshot:
      latest.find((snapshot) => snapshot.resource_identity === identity) ??
      null,
  }));
  const exactChoices = exact.map((snapshot) => ({
    token: `locked:${snapshot.id}`,
    label: `Exact version: ${snapshot.label}`,
    description: `Saved ${new Date(snapshot.observed_at).toLocaleString()}`,
    selection: { mode: "locked", snapshot_id: snapshot.id } as const,
    snapshot,
  }));

  return [...latestChoices, ...exactChoices];
}

export function defaultSavedInputChoice(
  node: GraphNodeDefinition,
  choices: SavedInputChoice[],
): SavedInputChoice | null {
  const requestedMode = node.resource_policy?.runtime_mode ?? "current";
  return (
    choices.find((choice) => choice.selection.mode === requestedMode) ??
    choices[0] ??
    null
  );
}

function humanizeIdentity(identity: string): string {
  return identity.replaceAll("_", " ").replaceAll("-", " ");
}
