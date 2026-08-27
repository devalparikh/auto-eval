"use client";

import { ArrowRightIcon, PlayIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { JsonViewer } from "@/components/json-viewer";
import { PageHeader } from "@/components/page-header";
import { Select } from "@/components/select";
import { ErrorState, LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import {
  graphVersions,
  promptVersions,
  systemByKey,
} from "@/features/catalog/catalog-options";
import {
  inputTemplateForRun,
  modelsForSystem,
  parseRunInput,
  PORTFOLIO_QUERY_SYSTEM_KEY,
} from "@/features/run/run-options";
import { RunGraphPreview } from "@/features/run/run-graph-preview";
import { RunNodeControls } from "@/features/run/run-node-controls";
import {
  RunPlanSummary,
  type RunPlanItem,
} from "@/features/run/run-plan-summary";
import { useRunLiveInputs } from "@/features/run/use-run-live-inputs";
import { useRunSavedInputs } from "@/features/run/use-run-saved-inputs";
import {
  graphPromptAssociations,
  promptForGraphKey,
  promptKeysForGraph,
} from "@/features/systems/graph-prompts";
import { RuntimeInputNotice } from "@/features/systems/runtime-input-notice";
import { systemPath } from "@/features/systems/system-path";
import { api } from "@/lib/api";
import { formatCost, formatDate, formatDuration, shortId } from "@/lib/format";
import { playPreferredUiSound } from "@/lib/sound";
import type { AgentSystemSummary, Catalog, Trace } from "@/lib/types";
import { useApiResource } from "@/lib/use-api-resource";

export function RunScreen({ systemKey }: { systemKey: string }) {
  const catalog = useApiResource(api.catalog, []);
  const system = systemByKey(catalog.data, systemKey);

  if (catalog.loading) {
    return (
      <>
        <PageHeader title="Run inference" />
        <LoadingState rows={9} />
      </>
    );
  }
  if (catalog.error) {
    return (
      <>
        <PageHeader title="Run inference" />
        <ErrorState message={catalog.error} retry={catalog.reload} />
      </>
    );
  }
  if (!catalog.data || !system) {
    return (
      <>
        <PageHeader title="Run inference" />
        <ErrorState message="Agent system not found" />
      </>
    );
  }

  return (
    <RunWorkbench
      key={system.id}
      catalog={catalog.data}
      system={system}
      systemKey={systemKey}
    />
  );
}

export function RunWorkbench({
  catalog,
  system,
  systemKey,
}: {
  catalog: Catalog;
  system: AgentSystemSummary;
  systemKey: string;
}) {
  const graphs = graphVersions(catalog, systemKey);
  const prompts = promptVersions(catalog, systemKey);
  const models = modelsForSystem(catalog, system.default_model_ids, systemKey);
  const isPortfolioQuery = systemKey === PORTFOLIO_QUERY_SYSTEM_KEY;
  const [input, setInput] = useState(
    JSON.stringify(
      inputTemplateForRun(systemKey, system.input_template ?? {}),
      null,
      2,
    ),
  );
  const [selectedGraphVersionId, setSelectedGraphVersionId] = useState(
    graphs[0]?.id ?? "",
  );
  const [selectedModelId, setSelectedModelId] = useState(models[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [captureNodeOutputs, setCaptureNodeOutputs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  const graphDetail = useApiResource(
    () =>
      selectedGraphVersionId
        ? api.agentVersion(selectedGraphVersionId)
        : Promise.reject(new Error("Select a graph version")),
    [selectedGraphVersionId],
  );
  const graphDefinition = graphDetail.data?.definition ?? null;
  const selectedGraphVersion = graphs.find(
    (version) => version.id === selectedGraphVersionId,
  );
  const graphVersionIsCurrent = graphDetail.data?.id === selectedGraphVersionId;
  const graphVersionIsChanging = graphDetail.loading || !graphVersionIsCurrent;
  const savedInputs = useRunSavedInputs(graphDefinition);
  const liveInputs = useRunLiveInputs(system.id, graphDefinition);
  const [promptVersionIds, setPromptVersionIds] = useState<
    Record<string, string>
  >({});
  const [promptGraphVersionId, setPromptGraphVersionId] = useState(
    selectedGraphVersionId,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeGraphId, setSelectedNodeGraphId] = useState<string | null>(
    null,
  );

  // Another graph can need a different set of prompts: start each one from its
  // newest version rather than carrying the last graph's choices over.
  if (promptGraphVersionId !== selectedGraphVersionId) {
    setPromptGraphVersionId(selectedGraphVersionId);
    setPromptVersionIds({});
  }
  // A different graph means a different set of nodes: open its first node
  // rather than keeping a selection that no longer exists.
  if (graphDetail.data && selectedNodeGraphId !== graphDetail.data.id) {
    setSelectedNodeGraphId(graphDetail.data.id);
    setSelectedNodeId(graphDetail.data.definition.entry_point);
  }

  const hasRefreshNodes =
    graphDefinition?.nodes.some(
      (node) => node.runtime_input_policy?.runtime_mode === "refresh",
    ) ?? false;
  const promptKeys = promptKeysForGraph(graphDetail.data?.definition ?? null);
  const promptFamilies = promptKeys.map((key) => ({
    key,
    prompt: promptForGraphKey(catalog, system.id, key),
  }));
  const missingPromptKeys = promptFamilies
    .filter(({ prompt }) => !prompt?.versions.length)
    .map(({ key }) => key);
  const usesKeyedPrompts = promptKeys.length > 0;
  const selectedPromptVersionIds = Object.fromEntries(
    promptFamilies.map(({ key, prompt }) => {
      const versions = prompt?.versions ?? [];
      const requested = versions.find(
        (version) => version.id === promptVersionIds[key],
      );
      return [key, (requested ?? versions[0])?.id ?? ""];
    }),
  ) as Record<string, string>;
  const planItems: RunPlanItem[] = [
    ...(usesKeyedPrompts
      ? promptFamilies.map(({ key, prompt }) => {
          const version = prompt?.versions.find(
            (candidate) => candidate.id === selectedPromptVersionIds[key],
          );
          return {
            nodeId:
              graphPromptAssociations(graphDefinition, key)[0]?.nodeId ?? "",
            label: prompt?.name ?? key,
            value: version ? `Version ${version.version}` : "No prompt yet",
            unset: !version,
          };
        })
      : []),
    ...savedInputs.savedInputNodes.map((node) => {
      const choice = savedInputs.choices[node.id]?.find(
        (candidate) =>
          candidate.token === savedInputs.selectedChoiceTokens[node.id],
      );
      return {
        nodeId: node.id,
        label: node.label,
        value: choice?.label ?? "Nothing saved yet",
        unset: !choice,
      };
    }),
    ...liveInputs.lockedNodes.map((node) => {
      const snapshot = liveInputs.choices[node.id]?.find(
        (candidate) => candidate.id === liveInputs.snapshotIds[node.id],
      );
      return {
        nodeId: node.id,
        label: node.label,
        value: snapshot?.label ?? "Nothing saved yet",
        unset: !snapshot,
      };
    }),
  ];
  const planWarnings = liveInputs.emptyOptionalNodes.map(
    (node) =>
      `${node.label} has no saved copy yet, so this run has no ${readableSource(
        node.runtime_input_policy?.source,
      )} data to read.`,
  );

  const hasExecutionInputs =
    graphs.length > 0 &&
    models.length > 0 &&
    (usesKeyedPrompts ? missingPromptKeys.length === 0 : prompts.length > 0);
  const runnable =
    hasExecutionInputs &&
    graphVersionIsCurrent &&
    !graphDetail.loading &&
    !graphDetail.error &&
    savedInputs.ready &&
    liveInputs.ready;
  const selectedModel = models.find((model) => model.id === selectedModelId);
  const product = catalog.agent_systems.find(
    (candidate) => candidate.key === system.product_key,
  );
  const pageTitle =
    system.flow_key === "run"
      ? `Run ${system.name}`
      : `${product?.name ?? system.name} · ${system.flow_name}`;

  function selectPromptVersion(promptKey: string, versionId: string) {
    setPromptVersionIds((current) => ({ ...current, [promptKey]: versionId }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    let requestInput: Record<string, unknown>;
    try {
      requestInput = parseRunInput(input);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Invalid request input.",
      );
      return;
    }

    const form = new FormData(event.currentTarget);
    const legacyPromptVersionId = usesKeyedPrompts
      ? Object.values(selectedPromptVersionIds)[0]
      : String(form.get("promptVersion"));
    setSubmitting(true);
    try {
      const completedTrace = await api.runTrace({
        input: requestInput,
        model_id: String(form.get("model")),
        agent_system_id: system.id,
        agent_system_version_id: selectedGraphVersionId,
        prompt_version_id: legacyPromptVersionId,
        ...(usesKeyedPrompts
          ? { prompt_version_ids: selectedPromptVersionIds }
          : {}),
        node_resource_selections: savedInputs.selections,
        ...(Object.keys(liveInputs.snapshotIds).length
          ? { runtime_input_snapshot_ids: liveInputs.snapshotIds }
          : {}),
        capture_node_outputs: captureNodeOutputs,
      });
      setTrace(completedTrace);
      if (completedTrace.status === "complete") {
        playPreferredUiSound("success");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Inference failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title={pageTitle}
        description="Choose a graph and model, set what each node uses, then run it."
      />
      <section className="grid gap-4 p-4 md:p-7">
        <form
          className="min-w-0 border border-[var(--border)] bg-[var(--surface)]"
          aria-busy={submitting}
          onSubmit={submit}
        >
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-[12px] font-semibold">Execution plan</h2>
          </div>
          <div className="grid gap-5 p-4 md:p-5">
            <div
              className={`grid gap-4 ${
                usesKeyedPrompts ? "md:grid-cols-2" : "md:grid-cols-3"
              }`}
            >
              <div className="field">
                <label htmlFor="run-graph-version">Graph version</label>
                <Select
                  id="run-graph-version"
                  name="graphVersion"
                  value={selectedGraphVersionId}
                  disabled={submitting || graphs.length === 0}
                  required
                  onChange={(event) =>
                    setSelectedGraphVersionId(event.target.value)
                  }
                >
                  {graphs.map((version) => (
                    <option key={version.id} value={version.id}>
                      {system.name} v{version.version}
                    </option>
                  ))}
                </Select>
              </div>
              {usesKeyedPrompts ? null : (
                <div className="field">
                  <label htmlFor="run-prompt-version">Prompt version</label>
                  <Select
                    id="run-prompt-version"
                    name="promptVersion"
                    disabled={submitting || prompts.length === 0}
                    required
                  >
                    {prompts.map((version) => (
                      <option key={version.id} value={version.id}>
                        Prompt v{version.version}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <div className="field">
                <label htmlFor="run-model">Model</label>
                <Select
                  id="run-model"
                  name="model"
                  value={selectedModelId}
                  disabled={submitting || models.length === 0}
                  required
                  onChange={(event) => setSelectedModelId(event.target.value)}
                >
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </Select>
                {selectedModel?.notice ? (
                  <p className="mt-1 text-[10px] leading-4 text-[var(--warning)]">
                    {selectedModel.notice}
                  </p>
                ) : null}
              </div>
            </div>

            <RunPlanSummary
              items={planItems}
              warnings={planWarnings}
              loading={savedInputs.loading || liveInputs.loading}
              onSelectNode={setSelectedNodeId}
            />

            <section
              className="min-w-0"
              aria-labelledby="run-graph-preview-title"
            >
              <div className="mb-2 flex items-end justify-between gap-4">
                <div>
                  <h3
                    id="run-graph-preview-title"
                    className="text-[11px] font-semibold"
                  >
                    Execution graph
                  </h3>
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                    Click a node to see what it does and change what it uses.
                    Drag to pan, or use the controls to zoom.
                  </p>
                </div>
                {selectedGraphVersion ? (
                  <span className="mono flex shrink-0 items-center gap-2 text-[9px] text-[var(--text-faint)]">
                    <span>v{selectedGraphVersion.version}</span>
                    <span>
                      {graphVersionIsChanging
                        ? graphDetail.error
                          ? "unavailable"
                          : "loading"
                        : `${graphDefinition?.nodes.length ?? 0} nodes`}
                    </span>
                  </span>
                ) : null}
              </div>
              <div
                className="relative min-h-[350px] md:min-h-[380px]"
                aria-busy={graphVersionIsChanging}
              >
                {graphDefinition ? (
                  <div
                    className={
                      graphVersionIsChanging
                        ? "opacity-45 transition-opacity motion-reduce:transition-none"
                        : "opacity-100 transition-opacity motion-reduce:transition-none"
                    }
                  >
                    <RunGraphPreview
                      definition={graphDefinition}
                      resourceSelections={savedInputs.selections}
                      selectedNodeId={selectedNodeId}
                      onSelectNode={setSelectedNodeId}
                      renderNodeControls={(view) => (
                        <RunNodeControls
                          view={view}
                          systemKey={systemKey}
                          prompt={
                            view.promptKey
                              ? promptForGraphKey(
                                  catalog,
                                  system.id,
                                  view.promptKey,
                                )
                              : undefined
                          }
                          promptVersionId={
                            view.promptKey
                              ? (selectedPromptVersionIds[view.promptKey] ?? "")
                              : ""
                          }
                          onSelectPromptVersion={selectPromptVersion}
                          savedInputChoices={savedInputs.choices[view.id] ?? []}
                          savedInputToken={
                            savedInputs.selectedChoiceTokens[view.id] ?? ""
                          }
                          savedInputLoading={savedInputs.loading}
                          onSelectSavedInput={savedInputs.select}
                          liveInputSnapshots={liveInputs.choices[view.id] ?? []}
                          liveInputSnapshotId={
                            liveInputs.snapshotIds[view.id] ?? ""
                          }
                          liveInputLoading={liveInputs.loading}
                          onSelectLiveInput={liveInputs.select}
                          captureNodeOutputs={captureNodeOutputs}
                          submitting={submitting}
                        />
                      )}
                    />
                  </div>
                ) : (
                  <div className="h-[350px] border border-[var(--border)] md:h-[380px]">
                    <LoadingState rows={3} />
                  </div>
                )}
                {graphVersionIsChanging && graphDefinition ? (
                  <div className="pointer-events-none absolute inset-0 grid place-items-center">
                    <p
                      className="border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-[10px] font-medium text-[var(--text-muted)] shadow-sm"
                      role="status"
                    >
                      {graphDetail.error
                        ? `Graph v${selectedGraphVersion?.version ?? ""} could not be loaded.`
                        : `Loading graph v${selectedGraphVersion?.version ?? ""}…`}
                    </p>
                  </div>
                ) : null}
              </div>
            </section>

            <RuntimeInputNotice definition={graphDefinition} context="run" />

            {hasRefreshNodes ? (
              <label className="flex cursor-pointer items-start gap-3 border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-3">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--accent)]"
                  checked={captureNodeOutputs}
                  disabled={submitting}
                  onChange={(event) =>
                    setCaptureNodeOutputs(event.target.checked)
                  }
                />
                <span>
                  <span className="block text-[11px] font-medium">
                    Keep a copy of live data
                  </span>
                  <span className="mt-1 block text-[10px] leading-5 text-[var(--text-muted)]">
                    Keep a copy of any live data this run fetches, so you can
                    reuse it later.
                  </span>
                </span>
              </label>
            ) : null}

            <div className="field">
              <label htmlFor="run-input">
                {isPortfolioQuery
                  ? "Advanced query input (JSON)"
                  : "Request input (JSON)"}
              </label>
              <textarea
                id="run-input"
                className="app-textarea mono min-h-[280px] text-[11px]"
                value={input}
                disabled={submitting}
                aria-invalid={error?.includes("JSON") ? true : undefined}
                aria-describedby={error ? "run-error" : "run-input-help"}
                spellCheck={false}
                onChange={(event) => setInput(event.target.value)}
              />
              <p
                id="run-input-help"
                className="text-[10px] text-[var(--text-faint)]"
              >
                {isPortfolioQuery
                  ? "Edit the question and policy here. The portfolio comes from the saved input above, and live market data is fetched when the run starts."
                  : "Prefilled from this system's example input."}
              </p>
            </div>
            {!hasExecutionInputs ? (
              <p
                id="run-error"
                role="alert"
                className="text-[11px] text-[var(--danger)]"
              >
                {missingPromptKeys.length
                  ? `This graph still needs a prompt for ${missingPromptKeys.join(", ")}.`
                  : "This system needs a graph, a prompt, and an available model before it can run."}
              </p>
            ) : graphDetail.error ? (
              <p
                id="run-error"
                role="alert"
                className="text-[11px] text-[var(--danger)]"
              >
                The selected graph could not be loaded: {graphDetail.error}
              </p>
            ) : savedInputs.savedInputNodes.length && savedInputs.error ? (
              <p
                id="run-error"
                role="alert"
                className="text-[11px] text-[var(--danger)]"
              >
                Saved inputs could not be loaded: {savedInputs.error}
              </p>
            ) : savedInputs.missingRequiredNodes.length ? (
              <p
                id="run-error"
                role="alert"
                className="text-[11px] text-[var(--danger)]"
              >
                This graph needs a saved{" "}
                {savedInputs.missingRequiredNodes
                  .map((node) => node.resource_policy?.resource_key)
                  .filter(Boolean)
                  .join(", ")}{" "}
                input before it can run. Create one first.
              </p>
            ) : liveInputs.lockedNodes.length && liveInputs.error ? (
              <p
                id="run-error"
                role="alert"
                className="text-[11px] text-[var(--danger)]"
              >
                Saved copies of live data could not be loaded:{" "}
                {liveInputs.error}
              </p>
            ) : liveInputs.missingRequiredNodes.length ? (
              <p
                id="run-error"
                role="alert"
                className="text-[11px] text-[var(--danger)]"
              >
                This graph reads a saved copy of{" "}
                {liveInputs.missingRequiredNodes
                  .map((node) =>
                    readableSource(node.runtime_input_policy?.source),
                  )
                  .join(", ")}{" "}
                instead of fetching it, and nothing has been saved yet. Run this
                graph with live data first, keeping a copy.
              </p>
            ) : error ? (
              <p
                id="run-error"
                role="alert"
                className="text-[11px] text-[var(--danger)]"
              >
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-[var(--border)] px-4 py-3 md:px-5">
            <p className="text-[10px] text-[var(--text-faint)]">
              A completed or failed execution will appear in Traces.
            </p>
            <button
              type="submit"
              className="app-button"
              disabled={submitting || !runnable}
            >
              <PlayIcon size={14} weight="fill" />
              {submitting ? "Running inference..." : "Run inference"}
            </button>
          </div>
        </form>

        <section
          className="min-w-0 border border-[var(--border)] bg-[var(--surface)]"
          aria-live="polite"
          aria-busy={submitting}
        >
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-[12px] font-semibold">Latest result</h2>
            {trace ? <StatusBadge status={trace.status} /> : null}
          </div>
          {submitting && !trace ? (
            <div className="p-4">
              <p className="text-[11px] font-medium">Executing graph</p>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                The trace will appear here when execution finishes.
              </p>
              <div className="mt-5">
                <LoadingState rows={5} />
              </div>
            </div>
          ) : trace ? (
            <RunResult trace={trace} systemKey={systemKey} />
          ) : (
            <div className="p-5">
              <p className="text-[11px] font-medium">No run in this session</p>
              <p className="mt-1 max-w-[34ch] text-[10px] leading-5 text-[var(--text-muted)]">
                Run the request to see its output, timing, tokens, and cost
                here.
              </p>
            </div>
          )}
        </section>
      </section>
    </>
  );
}

function readableSource(source: string | undefined): string {
  return (source ?? "live").replaceAll("_", " ");
}

function RunResult({ trace, systemKey }: { trace: Trace; systemKey: string }) {
  return (
    <div>
      <dl className="grid grid-cols-2 border-b border-[var(--border)]">
        <ResultMetric
          label="Latency"
          value={formatDuration(trace.latency_ms)}
        />
        <ResultMetric label="Cost" value={formatCost(trace.cost_usd)} />
        <ResultMetric
          label="Tokens"
          value={`${trace.input_tokens + trace.output_tokens}`}
          detail={`${trace.input_tokens} in / ${trace.output_tokens} out`}
        />
        <ResultMetric
          label="Completed"
          value={
            trace.completed_at
              ? formatDate(trace.completed_at)
              : "Not completed"
          }
        />
      </dl>
      <div className="border-b border-[var(--border)] p-4">
        <p className="mono text-[9px] tracking-[0.1em] text-[var(--text-faint)]">
          execution
        </p>
        <div className="mono mt-2 grid gap-1 text-[10px] text-[var(--text-muted)]">
          <p>Trace: {shortId(trace.id)}</p>
          <p>Model: {trace.model_id}</p>
        </div>
        {trace.error ? (
          <p
            role="alert"
            className="mt-3 text-[11px] leading-5 text-[var(--danger)]"
          >
            {trace.error}
          </p>
        ) : null}
      </div>
      {trace.output ? (
        <JsonViewer label="Agent output" value={trace.output} />
      ) : (
        <p className="p-4 text-[10px] text-[var(--text-muted)]">
          This trace did not produce an output payload.
        </p>
      )}
      <div className="border-t border-[var(--border)] p-4">
        <Link
          href={systemPath(systemKey, `traces/${trace.id}`)}
          className="app-button secondary w-full"
        >
          Inspect full trace
          <ArrowRightIcon size={14} />
        </Link>
      </div>
    </div>
  );
}

function ResultMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="min-h-[72px] border-r border-b border-[var(--border)] p-3 even:border-r-0 nth-last-[-n+2]:border-b-0">
      <dt className="text-[9px] text-[var(--text-faint)]">{label}</dt>
      <dd className="mono mt-1 text-[12px] font-semibold">{value}</dd>
      {detail ? (
        <dd className="mt-1 text-[9px] text-[var(--text-faint)]">{detail}</dd>
      ) : null}
    </div>
  );
}
