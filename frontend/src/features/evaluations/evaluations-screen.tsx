"use client";

import { FlaskIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PageHeader } from "@/components/page-header";
import { Select } from "@/components/select";
import { ErrorState, LoadingState } from "@/components/states";
import {
  availableModels,
  finalDatasetVersions,
  graphVersions,
  promptVersions,
  systemByKey,
} from "@/features/catalog/catalog-options";
import { ModelPicker } from "@/features/evaluations/model-picker";
import { RunStatusPanel } from "@/features/evaluations/run-status-panel";
import { useEvalRunPolling } from "@/features/evaluations/use-eval-run-polling";
import {
  promptForGraphKey,
  promptKeysForGraph,
} from "@/features/systems/graph-prompts";
import { api } from "@/lib/api";
import { playPreferredUiSound } from "@/lib/sound";
import { useApiResource } from "@/lib/use-api-resource";

export function EvaluationsScreen({ systemKey }: { systemKey: string }) {
  const catalog = useApiResource(api.catalog, []);
  const system = systemByKey(catalog.data, systemKey);
  const [requestedModels, setSelectedModels] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, setRun } = useEvalRunPolling();
  const previousRunStatus = useRef<string | null>(null);
  const datasets = finalDatasetVersions(catalog.data, systemKey);
  const models = availableModels(catalog.data, systemKey);
  const graphs = graphVersions(catalog.data, systemKey);
  const prompts = promptVersions(catalog.data, systemKey);
  const [selectedGraphVersionId, setSelectedGraphVersionId] = useState("");
  const graphVersionId = selectedGraphVersionId || graphs[0]?.id || "";
  const graphDetail = useApiResource(
    () =>
      graphVersionId
        ? api.agentVersion(graphVersionId)
        : Promise.reject(new Error("Select a graph version")),
    [graphVersionId],
  );
  const promptKeys = promptKeysForGraph(graphDetail.data?.definition ?? null);
  const promptFamilies = promptKeys.map((key) => ({
    key,
    prompt: promptForGraphKey(catalog.data, system?.id, key),
  }));
  const missingPromptKeys = promptFamilies
    .filter(({ prompt }) => !prompt?.versions.length)
    .map(({ key }) => key);
  const usesKeyedPrompts = promptKeys.length > 0;
  const selectedModels =
    requestedModels ??
    system?.default_model_ids.filter((modelId) =>
      models.some((model) => model.id === modelId),
    ) ??
    [];

  useEffect(() => {
    if (
      run?.status === "complete" &&
      previousRunStatus.current !== "complete"
    ) {
      playPreferredUiSound("success");
    }
    previousRunStatus.current = run?.status ?? null;
  }, [run?.status]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const promptVersionIds = Object.fromEntries(
      promptKeys.map((key) => [key, String(form.get(`promptVersion:${key}`))]),
    );
    const legacyPromptVersionId = usesKeyedPrompts
      ? Object.values(promptVersionIds)[0]
      : String(form.get("promptVersion"));
    setError(null);
    setSubmitting(true);
    try {
      const created = await api.createEvalRun({
        dataset_version_id: String(form.get("datasetVersion")),
        model_ids: selectedModels,
        agent_system_version_id: graphVersionId,
        prompt_version_id: legacyPromptVersionId,
        ...(usesKeyedPrompts ? { prompt_version_ids: promptVersionIds } : {}),
      });
      setRun(created);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not start evaluation",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title={`Evaluate ${system?.name ?? "agent system"}`}
        description="Pin every version and compare the same ground truth across models."
      />
      <section className="grid gap-5 p-4 md:p-7 xl:grid-cols-[minmax(0,720px)_minmax(280px,1fr)]">
        <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] px-5 py-4">
            <h2 className="text-[14px] font-semibold">Evaluation inputs</h2>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              Latest versions are selected by default. Final datasets only.
            </p>
          </div>
          {catalog.loading ? (
            <LoadingState rows={6} />
          ) : catalog.error ? (
            <ErrorState message={catalog.error} retry={catalog.reload} />
          ) : (
            <form onSubmit={submit} className="grid gap-5 p-5">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="field">
                  <label htmlFor="eval-dataset">Dataset version</label>
                  <Select id="eval-dataset" name="datasetVersion" required>
                    {datasets.map(({ dataset, version }) => (
                      <option key={version.id} value={version.id}>
                        {dataset.name} v{version.version}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="field">
                  <label htmlFor="eval-graph">Agent system</label>
                  <Select
                    id="eval-graph"
                    name="graphVersion"
                    value={graphVersionId}
                    required
                    onChange={(event) =>
                      setSelectedGraphVersionId(event.target.value)
                    }
                  >
                    {graphs.map((version) => (
                      <option key={version.id} value={version.id}>
                        {system?.name} v{version.version}
                      </option>
                    ))}
                  </Select>
                </div>
                {usesKeyedPrompts ? (
                  promptFamilies.map(({ key, prompt }) => (
                    <div className="field" key={key}>
                      <label htmlFor={`eval-prompt-${key}`}>
                        Prompt · {key}
                      </label>
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
                  ))
                ) : (
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
                )}
              </div>
              <ModelPicker
                models={models}
                selectedModelIds={selectedModels}
                onChange={setSelectedModels}
              />
              {missingPromptKeys.length || graphDetail.error || error ? (
                <p role="alert" className="text-[12px] text-[var(--danger)]">
                  {missingPromptKeys.length
                    ? `The selected graph references missing prompt families: ${missingPromptKeys.join(", ")}.`
                    : graphDetail.error
                      ? `The selected graph could not be loaded: ${graphDetail.error}`
                      : error}
                </p>
              ) : null}
              <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
                <p className="text-[10px] text-[var(--text-muted)]">
                  {datasets[0]?.version.item_count ?? 0} examples per model
                </p>
                <button
                  className="app-button"
                  disabled={
                    submitting ||
                    selectedModels.length === 0 ||
                    datasets.length === 0 ||
                    graphDetail.loading ||
                    Boolean(graphDetail.error) ||
                    missingPromptKeys.length > 0
                  }
                >
                  <FlaskIcon size={15} />
                  {submitting ? "Starting..." : "Start evaluation"}
                </button>
              </div>
            </form>
          )}
        </div>
        <RunStatusPanel run={run} systemKey={systemKey} />
      </section>
    </>
  );
}
