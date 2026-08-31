"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type {
  GraphDefinition,
  GraphNodeDefinition,
  RuntimeInputSnapshotSummary,
} from "@/lib/types";
import { useApiResource } from "@/lib/use-api-resource";

/**
 * Live-data nodes a graph version has pinned to a saved copy, and which copy
 * each one replays on this run.
 *
 * A graph decides whether a live node fetches or replays; a run only chooses
 * the copy, so nodes that fetch never appear here.
 */
export function useRunLiveInputs(
  agentSystemId: string,
  definition: GraphDefinition | null,
) {
  const [requestedIds, setRequestedIds] = useState<Record<string, string>>({});
  const lockedNodes = useMemo(
    () =>
      definition?.nodes.filter(
        (node) => node.runtime_input_policy?.runtime_mode === "locked",
      ) ?? [],
    [definition],
  );
  const policySignature = JSON.stringify(
    lockedNodes.map((node) => ({ id: node.id, ...node.runtime_input_policy })),
  );
  const snapshots = useApiResource(
    () => loadLiveInputSnapshots(agentSystemId, lockedNodes),
    [agentSystemId, policySignature],
  );
  const choices = useMemo(
    () =>
      Object.fromEntries(
        lockedNodes.map((node) => [node.id, snapshots.data?.[node.id] ?? []]),
      ) as Record<string, RuntimeInputSnapshotSummary[]>,
    [lockedNodes, snapshots.data],
  );
  const snapshotIds = useMemo(
    () =>
      Object.fromEntries(
        lockedNodes.flatMap((node) => {
          const available = choices[node.id] ?? [];
          const requested = available.find(
            (snapshot) => snapshot.id === requestedIds[node.id],
          );
          const chosen = requested ?? available[0];
          return chosen ? [[node.id, chosen.id]] : [];
        }),
      ) as Record<string, string>,
    [choices, lockedNodes, requestedIds],
  );
  const missingRequiredNodes = lockedNodes.filter(
    (node) => node.runtime_input_policy?.required && !snapshotIds[node.id],
  );
  const emptyOptionalNodes = lockedNodes.filter(
    (node) => !node.runtime_input_policy?.required && !snapshotIds[node.id],
  );
  const loading = snapshots.loading;
  const error = snapshots.error;

  function select(nodeId: string, snapshotId: string) {
    setRequestedIds((current) => ({ ...current, [nodeId]: snapshotId }));
  }

  return {
    lockedNodes,
    choices,
    snapshotIds,
    missingRequiredNodes,
    emptyOptionalNodes,
    loading,
    error,
    ready:
      lockedNodes.length === 0 ||
      (!loading && !error && missingRequiredNodes.length === 0),
    select,
  };
}

async function loadLiveInputSnapshots(
  agentSystemId: string,
  nodes: GraphNodeDefinition[],
) {
  return Object.fromEntries(
    await Promise.all(
      nodes.map(async (node) => {
        const policy = node.runtime_input_policy;
        if (!policy || !agentSystemId) return [node.id, []] as const;
        const snapshots = await api.runtimeInputSnapshots(agentSystemId, {
          sourceKey: policy.source,
          nodeId: node.id,
          limit: 200,
        });
        return [
          node.id,
          snapshots.filter(
            (snapshot) => snapshot.schema_version === policy.schema_version,
          ),
        ] as const;
      }),
    ),
  );
}
