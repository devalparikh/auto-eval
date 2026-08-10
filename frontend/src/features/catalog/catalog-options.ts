import type {
  Catalog,
  DatasetSummary,
  DatasetVersionSummary,
  ModelOption,
  AgentSystemSummary,
  VersionSummary,
} from "@/lib/types";

export type DatasetVersionOption = {
  dataset: DatasetSummary;
  version: DatasetVersionSummary;
};

export function systemByKey(
  catalog: Catalog | null,
  systemKey: string,
): AgentSystemSummary | null {
  return catalog?.agent_systems.find((system) => system.key === systemKey) ?? null;
}

export function finalDatasetVersions(
  catalog: Catalog | null,
  systemKey?: string,
): DatasetVersionOption[] {
  return datasetVersionsByStatus(catalog, "final", systemKey);
}

export function draftDatasetVersions(
  catalog: Catalog | null,
  systemKey?: string,
): DatasetVersionOption[] {
  return datasetVersionsByStatus(catalog, "draft", systemKey);
}

export function availableModels(catalog: Catalog | null): ModelOption[] {
  return catalog?.models.filter((model) => model.available) ?? [];
}

export function graphVersions(
  catalog: Catalog | null,
  systemKey: string,
): VersionSummary[] {
  return systemByKey(catalog, systemKey)?.versions ?? [];
}

export function promptVersions(
  catalog: Catalog | null,
  systemKey: string,
): VersionSummary[] {
  const system = systemByKey(catalog, systemKey);
  return (
    catalog?.prompts.find((prompt) => prompt.agent_system_id === system?.id)
      ?.versions ?? []
  );
}

function datasetVersionsByStatus(
  catalog: Catalog | null,
  status: DatasetVersionSummary["status"],
  systemKey?: string,
): DatasetVersionOption[] {
  const system = systemKey ? systemByKey(catalog, systemKey) : null;
  return (
    catalog?.datasets
      .filter((dataset) => !system || dataset.agent_system_id === system.id)
      .flatMap((dataset) =>
      dataset.versions
        .filter((version) => version.status === status)
        .map((version) => ({ dataset, version })),
      ) ?? []
  );
}
