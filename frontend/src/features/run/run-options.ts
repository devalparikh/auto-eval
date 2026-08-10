import type { Catalog, ModelOption } from "@/lib/types";

export const PORTFOLIO_QUERY_SYSTEM_KEY = "portfolio-query";

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
  systemKey: string,
  template: Record<string, unknown>,
): Record<string, unknown> {
  if (systemKey !== PORTFOLIO_QUERY_SYSTEM_KEY) return template;
  const advancedInput = { ...template };
  delete advancedInput.snapshot;
  delete advancedInput.snapshot_id;
  delete advancedInput.market_context;
  return advancedInput;
}

export function inputForRun(
  systemKey: string,
  advancedInput: Record<string, unknown>,
  snapshotId: string,
): Record<string, unknown> {
  if (systemKey !== PORTFOLIO_QUERY_SYSTEM_KEY) return advancedInput;
  const runtimeInput = { ...advancedInput };
  delete runtimeInput.market_context;
  return { ...runtimeInput, snapshot_id: snapshotId };
}
