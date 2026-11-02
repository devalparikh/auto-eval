"use client";

import { FlaskIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CatalogGate } from "@/components/catalog-gate";
import { PageHeader } from "@/components/page-header";
import { MultiSelect, Select } from "@/components/select";
import {
  availableModels,
  draftDatasetVersions,
  finalDatasetVersions,
  graphVersions,
  promptVersions,
} from "@/features/catalog/catalog-options";
import { ModelPicker } from "@/features/evaluations/model-picker";
import { RunStatusPanel } from "@/features/evaluations/run-status-panel";
import { useEvalRunPolling } from "@/features/evaluations/use-eval-run-polling";
import {
  promptForGraphKey,
  promptKeysForGraph,
} from "@/features/systems/graph-prompts";
import { RuntimeInputNotice } from "@/features/systems/runtime-input-notice";
import { api, ApiError } from "@/lib/api";
import { countOf } from "@/lib/format";
import { playPreferredUiSound } from "@/lib/sound";
import type {
  AgentSystemSummary,
  AgentVersionDetail,
  Catalog,
} from "@/lib/types";
import { useApiResource } from "@/lib/use-api-resource";
import { useCatalog } from "@/lib/use-catalog";

type BenchmarkRequest = Parameters<typeof api.createEvalRun>[0];

export function EvaluationsScreen({ systemKey }: { systemKey: string }) {
  return (
    <CatalogGate systemKey={systemKey}>
      {({ catalog, system }) => (
        <EvaluationsWorkbench
          key={system.id}
          catalog={catalog}
          system={system}
          systemKey={systemKey}
        />
      )}
    </CatalogGate>
  );
}

function EvaluationsWorkbench({
  catalog,
  system,
  systemKey,
}: {
  catalog: Catalog;
  system: AgentSystemSummary;
  systemKey: string;
}) {
  const [requestedModels, setSelectedModels] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The requests still unconfirmed after an interrupted response, kept verbatim
  // so retrying replays them with the same ids instead of starting duplicates.
  const [uncertainRequests, setUncertainRequests] = useState<
    BenchmarkRequest[] | null
  >(null);
  const uncertain = Boolean(uncertainRequests);
  const { runs, setRuns } = useEvalRunPolling();
  const wasAllComplete = useRef(false);
  const submittingRef = useRef(false);
  const attempt = useRef<{ signature: string; requestIds: string[] } | null>(
    null,
  );
  const { reload: reloadCatalog } = useCatalog();
  const datasets = [
    ...finalDatasetVersions(catalog, systemKey),
    ...draftDatasetVersions(catalog, systemKey),
  ];
  const [selectedDatasetVersionId, setDatasetVersionId] = useState("");
  const datasetVersionId = selectedDatasetVersionId || datasets[0]?.version.id || "";
  const datasetDetail = useApiResource(
    datasetVersionId ? () => api.datasetVersion(datasetVersionId) : null,
    [datasetVersionId],
  );
  const selectedDataset = datasets.find(
    ({ version }) => version.id === datasetVersionId,
  );
  const reviewedDataset =
    datasetDetail.data?.id === datasetVersionId ? datasetDetail.data : null;
  const selectedVersion = reviewedDataset ?? selectedDataset?.version;
  const isDraft = selectedVersion?.status === "draft";
  const models = availableModels(catalog, systemKey);
  const graphs = graphVersions(catalog, systemKey);
  const prompts = promptVersions(catalog, systemKey);
  const graphNumbers = new Map(
    graphs.map((version) => [version.id, version.version]),
  );
  const [requestedGraphIds, setSelectedGraphIds] = useState<string[] | null>(
    null,
  );
  // Oldest first: it becomes the baseline Results compares the others against.
  const selectedGraphs = graphs
    .filter((version) =>
      (requestedGraphIds ?? graphs.slice(0, 1).map(({ id }) => id)).includes(
        version.id,
      ),
    )
    .toSorted((left, right) => left.version - right.version);
  const graphSelectionKey = selectedGraphs.map(({ id }) => id).join(",");
  const graphDetail = useApiResource<AgentVersionDetail[]>(
    selectedGraphs.length
      ? () => Promise.all(selectedGraphs.map(({ id }) => api.agentVersion(id)))
      : null,
    [graphSelectionKey],
    { cacheKey: `graph-versions:${graphSelectionKey}` },
  );
  const graphDetails =
    graphDetail.data?.map(({ id }) => id).join(",") === graphSelectionKey
      ? (graphDetail.data ?? [])
      : [];
  const promptKeys = [
    ...new Set(
      graphDetails.flatMap((detail) => promptKeysForGraph(detail.definition)),
    ),
  ];
  const promptFamilies = promptKeys.map((key) => ({
    key,
    prompt: promptForGraphKey(catalog, system.id, key),
  }));
  const missingPromptKeys = promptFamilies
    .filter(({ prompt }) => !prompt?.versions.length)
    .map(({ key }) => key);
  const needsSystemPrompt =
    !graphDetails.length ||
    graphDetails.some(
      (detail) => promptKeysForGraph(detail.definition).length === 0,
    );
  const selectedModels =
    requestedModels ??
    system.default_model_ids.filter((modelId) =>
      models.some((model) => model.id === modelId),
    );

  const allComplete =
    runs.length > 0 && runs.every((run) => run.status === "complete");

  useEffect(() => {
    if (allComplete && !wasAllComplete.current) {
      playPreferredUiSound("success");
    }
    wasAllComplete.current = allComplete;
  }, [allComplete]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      submittingRef.current ||
      uncertain ||
      !reviewedDataset ||
      datasetDetail.loading ||
      datasetDetail.error
    ) return;
    const form = new FormData(event.currentTarget);
    const payloads = graphDetails.map((detail, index) => {
      const keys = promptKeysForGraph(detail.definition);
      const promptVersionIds = Object.fromEntries(
        keys.map((key) => [key, String(form.get(`promptVersion:${key}`))]),
      );
      return {
        dataset_version_id: datasetVersionId,
        model_ids: selectedModels,
        agent_system_version_id: detail.id,
        prompt_version_id: keys.length
          ? promptVersionIds[keys[0]]
          : String(form.get("promptVersion")),
        ...(keys.length ? { prompt_version_ids: promptVersionIds } : {}),
        // Only the first request finalizes, atomically with creating its run.
        // The rest see a dataset that is already final.
        ...(isDraft && index === 0
          ? {
            finalize_dataset: true,
            expected_dataset_revision: reviewedDataset.content_revision,
          }
          : {}),
      };
    });
    const signature = JSON.stringify(payloads);
    if (attempt.current?.signature !== signature) {
      attempt.current = {
        signature,
        requestIds: payloads.map(() => crypto.randomUUID()),
      };
    }
    const { requestIds } = attempt.current;
    setRuns([]);
    await startBenchmark(
      payloads.map((payload, index) => ({
        ...payload,
        request_id: requestIds[index],
      })),
    );
  }

  async function startBenchmark(requests: BenchmarkRequest[]) {
    if (submittingRef.current) return;
    setError(null);
    setSubmitting(true);
    submittingRef.current = true;
    let finalized = false;
    try {
      for (const [index, request] of requests.entries()) {
        try {
          const created = await api.createEvalRun(request);
          setRuns((current) => [...current, created]);
          finalized ||= Boolean(request.finalize_dataset);
        } catch (caught) {
          // No usable response means the server may have started this run, so
          // it stays queued for an exact retry. A rejection is final.
          setUncertainRequests(
            !(caught instanceof ApiError) || caught.status >= 500
              ? requests.slice(index)
              : null,
          );
          const reason =
            caught instanceof Error
              ? caught.message
              : "Could not start evaluation";
          const graphVersion = graphNumbers.get(
            request.agent_system_version_id ?? "",
          );
          setError(
            requests.length > 1 || index > 0
              ? `Graph v${graphVersion}: ${reason}`
              : reason,
          );
          return;
        }
      }
      setUncertainRequests(null);
      attempt.current = null;
    } finally {
      if (finalized) {
        if (reviewedDataset?.id === requests[0]?.dataset_version_id) {
          datasetDetail.setData({ ...reviewedDataset, status: "final" });
        }
        await Promise.all([datasetDetail.reload(), reloadCatalog()]);
      }
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const exampleCount = selectedVersion?.item_count ?? 0;

  return (
    <>
      <PageHeader
        title={`Evaluate ${system.name}`}
        description="Run one dataset across graph versions and models."
      />
      <section className="grid gap-5 p-4 md:p-7 xl:grid-cols-[minmax(0,720px)_minmax(280px,1fr)]">
        <div className="surface-card">
          <form onSubmit={submit} className="grid gap-5 p-5">
            <div className="grid items-end gap-4 md:grid-cols-3">
              <div className="field">
                <label htmlFor="eval-dataset">Dataset version</label>
                <Select
                  id="eval-dataset"
                  name="datasetVersion"
                  value={datasetVersionId}
                  disabled={submitting || uncertain}
                  onChange={(event) => {
                    setDatasetVersionId(event.target.value);
                    setError(null);
                  }}
                  required
                >
                  {datasets.map(({ dataset, version }) => (
                    <option key={version.id} value={version.id}>
                      {dataset.name} v{version.version} ({
                        (version.id === datasetVersionId ? selectedVersion : version)?.status === "draft"
                          ? "Draft" : "Finalized"
                      })
                    </option>
                  ))}
                </Select>
              </div>
              <div className="field">
                <span>Graph versions</span>
                <MultiSelect
                  label="Graph versions"
                  options={graphs.map((version, index) => ({
                    value: version.id,
                    label: `Version ${version.version}`,
                    detail: index === 0 ? "Latest" : undefined,
                  }))}
                  selected={selectedGraphs.map(({ id }) => id)}
                  onChange={setSelectedGraphIds}
                  disabled={submitting || uncertain}
                  placeholder="Select versions"
                />
              </div>
              {promptFamilies.map(({ key, prompt }) => (
                <div className="field" key={key}>
                  <label htmlFor={`eval-prompt-${key}`}>Prompt: {key}</label>
                  <Select
                    id={`eval-prompt-${key}`}
                    name={`promptVersion:${key}`}
                    disabled={!prompt?.versions.length}
                    required
                  >
                    {prompt?.versions.map((version) => (
                      <option key={version.id} value={version.id}>
                        {prompt.name} v{version.version}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
              {needsSystemPrompt ? (
                <div className="field">
                  <label htmlFor="eval-prompt">System prompt</label>
                  <Select id="eval-prompt" name="promptVersion" required>
                    {prompts.map((version) => (
                      <option key={version.id} value={version.id}>
                        Prompt v{version.version}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
            </div>
            {isDraft ? (
              <p id="dataset-finalization-notice" className="text-[12px] leading-relaxed text-[var(--text-muted)]">
                Starting this benchmark will permanently finalize v{selectedVersion?.version} with{" "}
                {selectedVersion?.item_count} examples. Further changes will require a new draft.
              </p>
            ) : null}
            {selectedVersion?.item_count === 0 ? (
              <p className="text-[12px] text-[var(--text-muted)]">
                Add at least one example before starting a benchmark.
              </p>
            ) : null}
            {reviewedDataset && isDraft ? (
              <details className="text-[12px] text-[var(--text-muted)]">
                <summary className="cursor-pointer">Review dataset examples</summary>
                <div className="mt-3 grid max-h-64 gap-3 overflow-auto">
                  {reviewedDataset.items.map((item, index) => (
                    <div key={item.id}>
                      <p>Example {index + 1}</p>
                      <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px]">
                        {JSON.stringify({ input: item.input, expected: item.expected }, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
            <RuntimeInputNotice
              definition={
                graphDetails.find(({ definition }) =>
                  definition.nodes.some((node) => node.runtime_input_policy),
                )?.definition ?? null
              }
              context="evaluation"
            />
            <ModelPicker
              models={models}
              selectedModelIds={selectedModels}
              onChange={setSelectedModels}
            />
            {missingPromptKeys.length || graphDetail.error || datasetDetail.error || error ? (
              <p role="alert" className="text-[12px] text-[var(--danger)]">
                {missingPromptKeys.length
                  ? `This graph needs prompts that do not exist yet: ${missingPromptKeys.join(", ")}.`
                  : graphDetail.error
                    ? `This graph could not be loaded: ${graphDetail.error}`
                    : datasetDetail.error ?? error}
              </p>
            ) : null}
            {uncertainRequests ? (
              <div className="grid gap-3 text-[12px] text-[var(--text-muted)]">
                <p>
                  The start response was interrupted. Retry the same request to recover its run
                  without creating a duplicate.
                </p>
                <button
                  type="button"
                  className="app-button secondary justify-self-start"
                  disabled={submitting}
                  onClick={() => startBenchmark(uncertainRequests)}
                >
                  Retry benchmark request
                </button>
              </div>
            ) : datasetDetail.error || error ? (
              <button
                type="button"
                className="app-button secondary justify-self-start"
                disabled={submitting || datasetDetail.loading}
                onClick={async () => {
                  await datasetDetail.reload();
                  setError(null);
                }}
              >
                Refresh dataset
              </button>
            ) : null}
            <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
              <p className="mono text-[10px] text-[var(--text-muted)]">
                {selectedGraphs.length > 1
                  ? `${countOf(exampleCount, "example")} × ${countOf(selectedGraphs.length, "graph")} × ${countOf(selectedModels.length, "model")}`
                  : `${countOf(exampleCount, "example")} per model`}
              </p>
              <button
                className="app-button"
                aria-describedby={isDraft ? "dataset-finalization-notice" : undefined}
                disabled={
                  submitting ||
                  uncertain ||
                  selectedModels.length === 0 ||
                  graphDetails.length === 0 ||
                  datasets.length === 0 ||
                  !reviewedDataset ||
                  selectedVersion?.item_count === 0 ||
                  datasetDetail.loading ||
                  Boolean(datasetDetail.error) ||
                  graphDetail.loading ||
                  Boolean(graphDetail.error) ||
                  missingPromptKeys.length > 0
                }
              >
                <FlaskIcon size={15} />
                {submitting ? "Starting benchmark" : isDraft ? "Finalize & run benchmark" : "Run benchmark"}
              </button>
            </div>
          </form>
        </div>
        <RunStatusPanel
          runs={runs}
          graphNumbers={graphNumbers}
          systemKey={systemKey}
        />
      </section>
    </>
  );
}
