import type {
  Catalog,
  DatasetSummary,
  DatasetVersionSummary,
  ModelOption,
  VersionSummary,
} from "@/lib/types";

export type DatasetVersionOption = {
  dataset: DatasetSummary;
  version: DatasetVersionSummary;
};

export function finalDatasetVersions(catalog: Catalog | null): DatasetVersionOption[] {
  return datasetVersionsByStatus(catalog, "final");
}

export function draftDatasetVersions(catalog: Catalog | null): DatasetVersionOption[] {
  return datasetVersionsByStatus(catalog, "draft");
}

export function availableModels(catalog: Catalog | null): ModelOption[] {
  return catalog?.models.filter((model) => model.available) ?? [];
}

export function graphVersions(catalog: Catalog | null): VersionSummary[] {
  return catalog?.agent_systems[0]?.versions ?? [];
}

export function promptVersions(catalog: Catalog | null): VersionSummary[] {
  return catalog?.prompts[0]?.versions ?? [];
}

function datasetVersionsByStatus(
  catalog: Catalog | null,
  status: DatasetVersionSummary["status"],
): DatasetVersionOption[] {
  return (
    catalog?.datasets.flatMap((dataset) =>
      dataset.versions
        .filter((version) => version.status === status)
        .map((version) => ({ dataset, version })),
    ) ?? []
  );
}
