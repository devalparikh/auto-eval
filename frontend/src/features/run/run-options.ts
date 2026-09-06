import type { Catalog, ModelOption } from "@/lib/types";

export const NODE_RESOURCE_QUERY_INPUT_EDITOR = "node-resource-query";

export function modelsForSystem(
  catalog: Catalog | null,
  defaultModelIds: string[],
  systemKey?: string,
): ModelOption[] {
  const available =
    catalog?.models.filter(
      (model) =>
        model.available &&
        (!systemKey || !model.blocked_agent_system_keys?.includes(systemKey)),
    ) ?? [];
  const defaults = new Set(defaultModelIds);
  return [
    ...available.filter((model) => defaults.has(model.id)),
    ...available.filter((model) => !defaults.has(model.id)),
  ];
}

export function parseRunInput(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Request input must be valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Request input must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function inputTemplateForRun(
  inputEditor: string,
  template: Record<string, unknown>,
): Record<string, unknown> {
  if (inputEditor !== NODE_RESOURCE_QUERY_INPUT_EDITOR) return template;
  const advancedInput = { ...template };
  delete advancedInput.snapshot;
  delete advancedInput.snapshot_id;
  delete advancedInput.market_context;
  return advancedInput;
}
