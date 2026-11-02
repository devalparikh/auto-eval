"use client";

import { useState, type ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { Select } from "@/components/select";
import {
  finalDatasetVersions,
  graphVersions,
  promptVersions,
  systemByKey,
} from "@/features/catalog/catalog-options";
import { CostAccuracyChart } from "@/features/results/cost-accuracy-chart";
import {
  buildResultRows,
  sortResultRows,
  versionNumbers,
} from "@/features/results/result-rows";
import { ResultsTable } from "@/features/results/results-table";
import { api } from "@/lib/api";
import { useApiResource } from "@/lib/use-api-resource";
import { useCatalog } from "@/lib/use-catalog";

export function ResultsScreen({
  systemKey,
  initialDatasetVersionId = "",
}: {
  systemKey: string;
  initialDatasetVersionId?: string;
}) {
  const catalog = useCatalog();
  const system = systemByKey(catalog.data, systemKey);
  const [requestedDatasetVersionId, setDatasetVersionId] = useState(
    initialDatasetVersionId,
  );
  const [graphVersionId, setGraphVersionId] = useState("");
  const [promptVersionId, setPromptVersionId] = useState("");
  const datasets = finalDatasetVersions(catalog.data, systemKey);
  const datasetVersionId =
    requestedDatasetVersionId || datasets[0]?.version.id || "";

  const query = (() => {
    if (!datasetVersionId) return "";
    const params = new URLSearchParams({
      dataset_version_id: datasetVersionId,
    });
    if (graphVersionId) params.set("agent_system_version_id", graphVersionId);
    if (promptVersionId) params.set("prompt_version_id", promptVersionId);
    return `?${params.toString()}`;
  })();
  const runs = useApiResource(
    () => (query ? api.evalRuns(query) : Promise.resolve([])),
    [query],
    { cacheKey: query ? `eval-runs:${query}` : null },
  );
  const numbers = versionNumbers(catalog.data, system?.id);
  const rows = sortResultRows(buildResultRows(runs.data), numbers);

  return (
    <>
      <PageHeader
        title={`${system?.name ?? "Agent system"} results`}
      />
      <section className="grid gap-4 p-4 md:p-7">
        <div className="grid gap-3 surface-card p-4 md:grid-cols-3">
          <FilterField label="Dataset version">
            <Select
              value={datasetVersionId}
              onChange={(event) => setDatasetVersionId(event.target.value)}
            >
              {datasets.map(({ dataset, version }) => (
                <option key={version.id} value={version.id}>
                  {dataset.name} v{version.version}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Graph version">
            <Select
              value={graphVersionId}
              onChange={(event) => setGraphVersionId(event.target.value)}
            >
              <option value="">All versions</option>
              {graphVersions(catalog.data, systemKey).map((version) => (
                <option key={version.id} value={version.id}>
                  Version {version.version}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Prompt version">
            <Select
              value={promptVersionId}
              onChange={(event) => setPromptVersionId(event.target.value)}
            >
              <option value="">All versions</option>
              {promptVersions(catalog.data, systemKey).map((version) => (
                <option key={version.id} value={version.id}>
                  Version {version.version}
                </option>
              ))}
            </Select>
          </FilterField>
        </div>
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.25fr)_minmax(420px,0.75fr)]">
          <ResultsTable
            rows={rows}
            numbers={numbers}
            systemKey={systemKey}
            loading={runs.loading}
            error={runs.error}
            retry={runs.reload}
          />
          <CostAccuracyChart rows={rows} numbers={numbers} />
        </div>
      </section>
    </>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
