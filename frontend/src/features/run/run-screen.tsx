"use client";

import { ArrowRightIcon, DatabaseIcon, PlayIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
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
import {
  defaultResourceChoice,
  resourceChoicesForNode,
  type ResourceChoice,
} from "@/features/run/run-resource-options";
import {
  promptForGraphKey,
  promptKeysForGraph,
} from "@/features/systems/graph-prompts";
import { RuntimeInputNotice } from "@/features/systems/runtime-input-notice";
import { systemPath } from "@/features/systems/system-path";
import { api } from "@/lib/api";
import { formatCost, formatDate, formatDuration, shortId } from "@/lib/format";
import { playPreferredUiSound } from "@/lib/sound";
import type {
  AgentSystemSummary,
  Catalog,
  GraphNodeDefinition,
  NodeResourceSelection,
  Trace,
} from "@/lib/types";
import { useApiResource } from "@/lib/use-api-resource";

export function RunScreen({ systemKey }: { systemKey: string }) {
  const catalog = useApiResource(api.catalog, []);
  const system = systemByKey(catalog.data, systemKey);

  if (catalog.loading) {
    return (
      <>
        <PageHeader
          title="Run inference"
          description="Loading the available graph, prompt, and model versions."
        />
        <LoadingState rows={9} />
      </>
    );
  }
  if (catalog.error) {
    return (
      <>
        <PageHeader
          title="Run inference"
          description="Configure an agent request."
        />
        <ErrorState message={catalog.error} retry={catalog.reload} />
      </>
    );
  }
  if (!catalog.data || !system) {
    return (
      <>
        <PageHeader
          title="Run inference"
          description="Configure an agent request."
        />
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
  const [resourceChoiceTokens, setResourceChoiceTokens] = useState<
    Record<string, string>
  >({});
  const [resourceIdentities, setResourceIdentities] = useState<
    Record<string, string>
  >({});
  const [captureNodeOutputs, setCaptureNodeOutputs] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
  const resourceNodes = useMemo(
    () => graphDefinition?.nodes.filter((node) => node.resource_policy) ?? [],
    [graphDefinition],
  );
  const hasRefreshNodes =
    graphDefinition?.nodes.some(
      (node) => node.runtime_input_policy?.runtime_mode === "refresh",
    ) ?? false;
  const resourcePolicySignature = JSON.stringify(
    resourceNodes.map((node) => ({ id: node.id, ...node.resource_policy })),
  );
  const currentResourceSnapshots = useApiResource(
    async () =>
      Object.fromEntries(
        await Promise.all(
          resourceNodes.map(async (node) => {
            const policy = node.resource_policy;
            if (!policy) return [node.id, []] as const;
            const snapshots = await api.nodeSnapshots({
              productKey: policy.product_key,
              agentSystemKey: policy.producer_system_key,
              nodeId: policy.producer_node_id,
              outputKey: policy.producer_output_key,
              schemaVersion: policy.schema_version,
              snapshotKind: policy.producer_snapshot_kind,
              latestPerIdentity: true,
              limit: 500,
            });
            return [node.id, snapshots] as const;
          }),
        ),
      ),
    [resourcePolicySignature],
  );
  const currentResourceChoicesByNode = useMemo(
    () =>
      Object.fromEntries(
        resourceNodes.map((node) => [
          node.id,
          resourceChoicesForNode(
            node,
            currentResourceSnapshots.data?.[node.id] ?? [],
            [],
          ),
        ]),
      ) as Record<string, ResourceChoice[]>,
    [currentResourceSnapshots.data, resourceNodes],
  );
  const selectedResourceIdentities = useMemo(
    () =>
      Object.fromEntries(
        resourceNodes.flatMap((node) => {
          const currentChoices = currentResourceChoicesByNode[node.id] ?? [];
          const requestedIdentity = resourceIdentities[node.id];
          const selected = currentChoices.find(
            (choice) =>
              choice.selection.mode === "current" &&
              choice.selection.identity === requestedIdentity,
          );
          const fallback = currentChoices.find(
            (choice) => choice.selection.mode === "current",
          );
          const choice = selected ?? fallback;
          return choice?.selection.mode === "current"
            ? [[node.id, choice.selection.identity]]
            : [];
        }),
      ) as Record<string, string>,
    [currentResourceChoicesByNode, resourceIdentities, resourceNodes],
  );
  const resourceIdentitySignature = JSON.stringify(selectedResourceIdentities);
  const lockedResourceSnapshots = useApiResource(
    async () =>
      Object.fromEntries(
        await Promise.all(
          resourceNodes.map(async (node) => {
            const policy = node.resource_policy;
            const identity = selectedResourceIdentities[node.id];
            if (!policy || !identity) return [node.id, []] as const;
            const snapshots = await api.nodeSnapshots({
              productKey: policy.product_key,
              agentSystemKey: policy.producer_system_key,
              nodeId: policy.producer_node_id,
              outputKey: policy.producer_output_key,
              schemaVersion: policy.schema_version,
              snapshotKind: policy.producer_snapshot_kind,
              resourceIdentity: identity,
              limit: 500,
            });
            return [node.id, snapshots] as const;
          }),
        ),
      ),
    [resourcePolicySignature, resourceIdentitySignature],
  );
  const resourceChoicesByNode = useMemo(
    () =>
      Object.fromEntries(
        resourceNodes.map((node) => [
          node.id,
          resourceChoicesForNode(
            node,
            currentResourceSnapshots.data?.[node.id] ?? [],
            lockedResourceSnapshots.data?.[node.id] ?? [],
          ),
        ]),
      ) as Record<string, ResourceChoice[]>,
    [
      currentResourceSnapshots.data,
      lockedResourceSnapshots.data,
      resourceNodes,
    ],
  );
  const effectiveResourceChoiceTokens = useMemo(
    () =>
      Object.fromEntries(
        resourceNodes.map((node) => {
          const choices = resourceChoicesByNode[node.id] ?? [];
          const current = resourceChoiceTokens[node.id];
          const selected = choices.some((choice) => choice.token === current)
            ? current
            : (defaultResourceChoice(node, choices)?.token ?? "");
          return [node.id, selected];
        }),
      ),
    [resourceChoiceTokens, resourceChoicesByNode, resourceNodes],
  );
  const resourceSelections = useMemo(
    () =>
      Object.fromEntries(
        resourceNodes.flatMap((node) => {
          const choice = resourceChoicesByNode[node.id]?.find(
            (candidate) =>
              candidate.token === effectiveResourceChoiceTokens[node.id],
          );
          return choice ? [[node.id, choice.selection]] : [];
        }),
      ) as Record<string, NodeResourceSelection>,
    [effectiveResourceChoiceTokens, resourceChoicesByNode, resourceNodes],
  );
  const promptKeys = promptKeysForGraph(graphDetail.data?.definition ?? null);
  const promptFamilies = promptKeys.map((key) => ({
    key,
    prompt: promptForGraphKey(catalog, system.id, key),
  }));
  const missingPromptKeys = promptFamilies
    .filter(({ prompt }) => !prompt?.versions.length)
    .map(({ key }) => key);
  const usesKeyedPrompts = promptKeys.length > 0;

  const hasExecutionInputs =
    graphs.length > 0 &&
    models.length > 0 &&
    (usesKeyedPrompts ? missingPromptKeys.length === 0 : prompts.length > 0);
  const missingRequiredResources = resourceNodes.filter(
    (node) => node.resource_policy?.required && !resourceSelections[node.id],
  );
  const resourceLoading =
    currentResourceSnapshots.loading || lockedResourceSnapshots.loading;
  const resourceError =
    currentResourceSnapshots.error ?? lockedResourceSnapshots.error;
  const resourcesReady =
    resourceNodes.length === 0 ||
    (!resourceLoading &&
      !resourceError &&
      missingRequiredResources.length === 0);
  const runnable =
    hasExecutionInputs &&
    !graphDetail.loading &&
    !graphDetail.error &&
    resourcesReady;
  const selectedModel = models.find((model) => model.id === selectedModelId);
  const product = catalog.agent_systems.find(
    (candidate) => candidate.key === system.product_key,
  );
  const pageTitle =
    system.flow_key === "run"
      ? `Run ${system.name}`
      : `${product?.name ?? system.name} · ${system.flow_name}`;

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
    const promptVersionIds = Object.fromEntries(
      promptKeys.map((key) => [key, String(form.get(`promptVersion:${key}`))]),
    );
    const legacyPromptVersionId = usesKeyedPrompts
      ? Object.values(promptVersionIds)[0]
      : String(form.get("promptVersion"));
    setSubmitting(true);
    try {
      const completedTrace = await api.runTrace({
        input: requestInput,
        model_id: String(form.get("model")),
        agent_system_id: system.id,
        agent_system_version_id: selectedGraphVersionId,
        prompt_version_id: legacyPromptVersionId,
        ...(usesKeyedPrompts ? { prompt_version_ids: promptVersionIds } : {}),
        node_resource_selections: resourceSelections,
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
        description="Configure one pinned execution, inspect how every graph node will resolve, then run it as a normal persisted trace."
      />
      <section className="grid gap-4 p-4 md:p-7">
        <form
          className="min-w-0 border border-[var(--border)] bg-[var(--surface)]"
          aria-busy={submitting}
          onSubmit={submit}
        >
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-[12px] font-semibold">Execution plan</h2>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              Versions and data bindings are explicit. Business input stays
              separate from graph-owned resources and observations.
            </p>
          </div>
          <div className="grid gap-5 p-4 md:p-5">
            <div className="grid gap-4 md:grid-cols-3">
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
              {usesKeyedPrompts ? (
                promptFamilies.map(({ key, prompt }) => (
                  <div className="field" key={key}>
                    <label htmlFor={`run-prompt-${key}`}>Prompt · {key}</label>
                    <Select
                      id={`run-prompt-${key}`}
                      name={`promptVersion:${key}`}
                      disabled={submitting || !prompt?.versions.length}
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
                  <p className="mt-1 text-[10px] leading-4 text-amber-700 dark:text-amber-300">
                    {selectedModel.notice}
                  </p>
                ) : null}
              </div>
            </div>

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
                    Node classes reflect this direct run and its selected data
                    bindings. Drag to pan or use the controls to zoom.
                  </p>
                </div>
                {graphDetail.data ? (
                  <span className="mono shrink-0 text-[9px] text-[var(--text-faint)]">
                    v{graphDetail.data.version} ·{" "}
                    {graphDefinition?.nodes.length ?? 0} nodes
                  </span>
                ) : null}
              </div>
              {graphDetail.loading ? (
                <LoadingState rows={3} />
              ) : graphDefinition ? (
                <RunGraphPreview
                  definition={graphDefinition}
                  resourceSelections={resourceSelections}
                  captureNodeOutputs={captureNodeOutputs}
                />
              ) : null}
            </section>

            {resourceNodes.length ? (
              <section
                className="border-t border-[var(--border)] pt-5"
                aria-labelledby="run-resource-bindings-title"
              >
                <div className="mb-3">
                  <h3
                    id="run-resource-bindings-title"
                    className="text-[11px] font-semibold"
                  >
                    Graph resources
                  </h3>
                  <p className="mt-1 text-[10px] leading-5 text-[var(--text-muted)]">
                    Current resolves the newest indexed version for one stable
                    identity at run start. Locked references one exact immutable
                    snapshot; its menu shows up to 500 newest versions for the
                    selected identity. Stored resource content is never
                    resubmitted as business input.
                  </p>
                </div>
                {resourceLoading ? (
                  <LoadingState rows={2} />
                ) : (
                  <div className="grid gap-3">
                    {resourceNodes.map((node) => (
                      <ResourceBindingField
                        key={node.id}
                        node={node}
                        choices={resourceChoicesByNode[node.id] ?? []}
                        selectedToken={
                          effectiveResourceChoiceTokens[node.id] ?? ""
                        }
                        submitting={submitting}
                        onSelect={(token) => {
                          const choice = resourceChoicesByNode[node.id]?.find(
                            (candidate) => candidate.token === token,
                          );
                          const identity =
                            choice?.selection.mode === "current"
                              ? choice.selection.identity
                              : choice?.snapshot?.resource_identity;
                          setResourceChoiceTokens((current) => ({
                            ...current,
                            [node.id]: token,
                          }));
                          if (identity) {
                            setResourceIdentities((current) => ({
                              ...current,
                              [node.id]: identity,
                            }));
                          }
                        }}
                      />
                    ))}
                  </div>
                )}
              </section>
            ) : null}

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
                    Capture refreshed external outputs
                  </span>
                  <span className="mt-1 block text-[10px] leading-5 text-[var(--text-muted)]">
                    Optional and off by default. Saves live/refreshed
                    observations as immutable node snapshots. Required
                    graph-produced artifacts are always captured by their graph
                    contract and cannot be disabled here.
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
                  ? "Question and policy remain editable. Indexed portfolio state is resolved through the graph resource binding above; registered external observations refresh at runtime."
                  : "Initialized from this system's registered input template."}
              </p>
            </div>
            {!hasExecutionInputs ? (
              <p
                id="run-error"
                role="alert"
                className="text-[11px] text-[var(--danger)]"
              >
                {missingPromptKeys.length
                  ? `The selected graph references missing prompt families: ${missingPromptKeys.join(", ")}.`
                  : "This system needs at least one graph, prompt, and available model before it can run."}
              </p>
            ) : graphDetail.error ? (
              <p
                id="run-error"
                role="alert"
                className="text-[11px] text-[var(--danger)]"
              >
                The selected graph could not be loaded: {graphDetail.error}
              </p>
            ) : resourceNodes.length && resourceError ? (
              <p
                id="run-error"
                role="alert"
                className="text-[11px] text-[var(--danger)]"
              >
                Graph resources could not be loaded: {resourceError}
              </p>
            ) : missingRequiredResources.length ? (
              <p
                id="run-error"
                role="alert"
                className="text-[11px] text-[var(--danger)]"
              >
                Index or seed the required{" "}
                {missingRequiredResources
                  .map((node) => node.resource_policy?.resource_key)
                  .filter(Boolean)
                  .join(", ")}{" "}
                resource before running this graph.
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
                Run the configured request to inspect output, timing, token
                usage, and cost without leaving this page.
              </p>
            </div>
          )}
        </section>
      </section>
    </>
  );
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
        <p className="mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
          Execution
        </p>
        <p className="mono mt-2 text-[10px] text-[var(--text-muted)]">
          {shortId(trace.id)} · {trace.model_id}
        </p>
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

function ResourceBindingField({
  node,
  choices,
  selectedToken,
  submitting,
  onSelect,
}: {
  node: GraphNodeDefinition;
  choices: ResourceChoice[];
  selectedToken: string;
  submitting: boolean;
  onSelect: (token: string) => void;
}) {
  const policy = node.resource_policy;
  const selected = choices.find((choice) => choice.token === selectedToken);
  if (!policy) return null;
  const currentChoices = choices.filter(
    (choice) => choice.selection.mode === "current",
  );
  const lockedChoices = choices.filter(
    (choice) => choice.selection.mode === "locked",
  );
  return (
    <div className="grid gap-3 border border-[var(--border)] p-3 md:grid-cols-[minmax(200px,0.38fr)_minmax(0,1fr)]">
      <div className="flex items-start gap-2">
        <DatabaseIcon
          size={14}
          className="mt-0.5 shrink-0 text-[var(--accent)]"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold">{node.label}</p>
          <p className="mono mt-1 break-all text-[8px] leading-4 text-[var(--text-faint)]">
            {node.id} · {policy.resource_key} · schema v{policy.schema_version}
          </p>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`run-resource-${node.id}`}>Resource version</label>
        <Select
          id={`run-resource-${node.id}`}
          value={selectedToken}
          disabled={submitting || choices.length === 0}
          required={policy.required}
          onChange={(event) => onSelect(event.target.value)}
        >
          {choices.length === 0 ? (
            <option value="">No compatible resource snapshots</option>
          ) : null}
          {currentChoices.length ? (
            <optgroup label="Current resource identity">
              {currentChoices.map((choice) => (
                <option key={choice.token} value={choice.token}>
                  {choice.label}
                </option>
              ))}
            </optgroup>
          ) : null}
          {lockedChoices.length ? (
            <optgroup label="Exact locked snapshot">
              {lockedChoices.map((choice) => (
                <option key={choice.token} value={choice.token}>
                  {choice.label}
                </option>
              ))}
            </optgroup>
          ) : null}
        </Select>
        <p className="text-[9px] leading-4 text-[var(--text-muted)]">
          {selected?.description ??
            "No compatible producer snapshot exists for this graph contract."}
        </p>
        {selected?.snapshot ? (
          <p className="mono text-[8px] text-[var(--text-faint)]">
            {selected.snapshot.is_synthetic ? "synthetic" : "real"} ·{" "}
            {shortId(selected.snapshot.id)} ·{" "}
            {selected.snapshot.content_hash.slice(0, 10)}
          </p>
        ) : null}
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
