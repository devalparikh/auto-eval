import type {
  GraphNodeDefinition,
  NodeResourceSelection,
  NodeSnapshotSummary,
} from "@/lib/types";

export type ResourceChoice = {
  token: string;
  label: string;
  description: string;
  selection: NodeResourceSelection;
  snapshot: NodeSnapshotSummary | null;
};

export function snapshotsForResourceNode(
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

export function resourceChoicesForNode(
  node: GraphNodeDefinition,
  currentSnapshots: NodeSnapshotSummary[],
  lockedSnapshots: NodeSnapshotSummary[] = currentSnapshots,
): ResourceChoice[] {
  const current = snapshotsForResourceNode(node, currentSnapshots);
  const locked = snapshotsForResourceNode(node, lockedSnapshots);
  const identities = [
    ...new Set(
      current
        .map((snapshot) => snapshot.resource_identity)
        .filter((identity): identity is string => Boolean(identity)),
    ),
  ];
  const currentChoices = identities.map((identity) => ({
    token: `current:${identity}`,
    label: `Current · ${humanizeIdentity(identity)}`,
    description: "Newest indexed version for this identity at run start",
    selection: { mode: "current", identity } as const,
    snapshot:
      current.find((snapshot) => snapshot.resource_identity === identity) ??
      null,
  }));
  const lockedChoices = locked.map((snapshot) => ({
    token: `locked:${snapshot.id}`,
    label: `Locked · ${snapshot.label}`,
    description: `Exact snapshot · ${new Date(snapshot.observed_at).toLocaleString()}`,
    selection: { mode: "locked", snapshot_id: snapshot.id } as const,
    snapshot,
  }));

  return [...currentChoices, ...lockedChoices];
}

export function defaultResourceChoice(
  node: GraphNodeDefinition,
  choices: ResourceChoice[],
): ResourceChoice | null {
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
