import type { Catalog, GraphDefinition, PromptSummary } from "@/lib/types";

export function promptKeysForGraph(definition: GraphDefinition | null) {
  return Array.from(
    new Set(
      (definition?.nodes ?? [])
        .map((node) => node.prompt_key?.trim())
        .filter((key): key is string => Boolean(key)),
    ),
  );
}

export function promptForGraphKey(
  catalog: Catalog | null,
  agentSystemId: string | undefined,
  promptKey: string,
): PromptSummary | undefined {
  return catalog?.prompts.find(
    (prompt) =>
      prompt.agent_system_id === agentSystemId && prompt.key === promptKey,
  );
}

export function graphPromptAssociations(
  definition: GraphDefinition | null,
  promptKey: string,
) {
  return (definition?.nodes ?? [])
    .filter((node) => node.prompt_key === promptKey)
    .map((node) => ({ nodeId: node.id, label: node.label }));
}
