"use client";

import { useMemo, useState } from "react";
import {
  defaultSavedInputChoice,
  savedInputChoicesForNode,
  type SavedInputChoice,
} from "@/features/run/run-saved-input-options";
import { api } from "@/lib/api";
import type {
  GraphDefinition,
  GraphNodeDefinition,
  NodeResourceSelection,
} from "@/lib/types";
import { useApiResource } from "@/lib/use-api-resource";

export function useRunSavedInputs(definition: GraphDefinition | null) {
  const [choiceTokens, setChoiceTokens] = useState<Record<string, string>>({});
  const [identities, setIdentities] = useState<Record<string, string>>({});
  const savedInputNodes = useMemo(
    () => definition?.nodes.filter((node) => node.resource_policy) ?? [],
    [definition],
  );
  const policySignature = JSON.stringify(
    savedInputNodes.map((node) => ({ id: node.id, ...node.resource_policy })),
  );
  const latestSnapshots = useApiResource(
    () => loadSavedInputSnapshots(savedInputNodes, true),
    [policySignature],
  );
  const latestChoices = useMemo(
    () =>
      choicesByNode(
        savedInputNodes,
        latestSnapshots.data,
        Object.fromEntries(savedInputNodes.map((node) => [node.id, []])),
      ),
    [latestSnapshots.data, savedInputNodes],
  );
  const selectedIdentities = useMemo(
    () =>
      Object.fromEntries(
        savedInputNodes.flatMap((node) => {
          const choices = latestChoices[node.id] ?? [];
          const requested = identities[node.id];
          const selected = choices.find(
            (choice) =>
              choice.selection.mode === "current" &&
              choice.selection.identity === requested,
          );
          const fallback = choices.find(
            (choice) => choice.selection.mode === "current",
          );
          const choice = selected ?? fallback;
          return choice?.selection.mode === "current"
            ? [[node.id, choice.selection.identity]]
            : [];
        }),
      ) as Record<string, string>,
    [identities, latestChoices, savedInputNodes],
  );
  const identitySignature = JSON.stringify(selectedIdentities);
  const exactSnapshots = useApiResource(
    () => loadSavedInputSnapshots(savedInputNodes, false, selectedIdentities),
    [policySignature, identitySignature],
  );
  const choices = useMemo(
    () =>
      choicesByNode(savedInputNodes, latestSnapshots.data, exactSnapshots.data),
    [exactSnapshots.data, latestSnapshots.data, savedInputNodes],
  );
  const selectedChoiceTokens = useMemo(
    () =>
      Object.fromEntries(
        savedInputNodes.map((node) => {
          const nodeChoices = choices[node.id] ?? [];
          const requested = choiceTokens[node.id];
          const selected = nodeChoices.some(
            (choice) => choice.token === requested,
          )
            ? requested
            : (defaultSavedInputChoice(node, nodeChoices)?.token ?? "");
          return [node.id, selected];
        }),
      ),
    [choiceTokens, choices, savedInputNodes],
  );
  const selections = useMemo(
    () =>
      Object.fromEntries(
        savedInputNodes.flatMap((node) => {
          const choice = choices[node.id]?.find(
            (candidate) => candidate.token === selectedChoiceTokens[node.id],
          );
          return choice ? [[node.id, choice.selection]] : [];
        }),
      ) as Record<string, NodeResourceSelection>,
    [choices, savedInputNodes, selectedChoiceTokens],
  );
  const missingRequiredNodes = savedInputNodes.filter(
    (node) => node.resource_policy?.required && !selections[node.id],
  );
  const loading = latestSnapshots.loading || exactSnapshots.loading;
  const error = latestSnapshots.error ?? exactSnapshots.error;

  function select(nodeId: string, token: string) {
    const choice = choices[nodeId]?.find(
      (candidate) => candidate.token === token,
    );
    const identity =
      choice?.selection.mode === "current"
        ? choice.selection.identity
        : choice?.snapshot?.resource_identity;
    setChoiceTokens((current) => ({ ...current, [nodeId]: token }));
    if (identity) {
      setIdentities((current) => ({ ...current, [nodeId]: identity }));
    }
  }

  return {
    savedInputNodes,
    choices,
    selectedChoiceTokens,
    selections,
    missingRequiredNodes,
    loading,
    error,
    ready:
      savedInputNodes.length === 0 ||
      (!loading && !error && missingRequiredNodes.length === 0),
    select,
  };
}

async function loadSavedInputSnapshots(
  nodes: GraphNodeDefinition[],
  latestPerIdentity: boolean,
  identities: Record<string, string> = {},
) {
  return Object.fromEntries(
    await Promise.all(
      nodes.map(async (node) => {
        const policy = node.resource_policy;
        const resourceIdentity = identities[node.id];
        if (!policy || (!latestPerIdentity && !resourceIdentity)) {
          return [node.id, []] as const;
        }
        const snapshots = await api.nodeSnapshots({
          productKey: policy.product_key,
          agentSystemKey: policy.producer_system_key,
          nodeId: policy.producer_node_id,
          outputKey: policy.producer_output_key,
          schemaVersion: policy.schema_version,
          snapshotKind: policy.producer_snapshot_kind,
          ...(latestPerIdentity
            ? { latestPerIdentity: true }
            : { resourceIdentity }),
          limit: 500,
        });
        return [node.id, snapshots] as const;
      }),
    ),
  );
}

function choicesByNode(
  nodes: GraphNodeDefinition[],
  latestSnapshots: Awaited<ReturnType<typeof loadSavedInputSnapshots>> | null,
  exactSnapshots: Awaited<ReturnType<typeof loadSavedInputSnapshots>> | null,
): Record<string, SavedInputChoice[]> {
  return Object.fromEntries(
    nodes.map((node) => [
      node.id,
      savedInputChoicesForNode(
        node,
        latestSnapshots?.[node.id] ?? [],
        exactSnapshots?.[node.id] ?? [],
      ),
    ]),
  );
}
