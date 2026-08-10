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
import { modelsForSystem, parseRunInput } from "@/features/run/run-options";
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
  const [input, setInput] = useState(
    JSON.stringify(system.input_template ?? {}, null, 2),
  );
  const [selectedModelId, setSelectedModelId] = useState(models[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);

  const runnable = graphs.length > 0 && prompts.length > 0 && models.length > 0;
  const selectedModel = models.find((model) => model.id === selectedModelId);

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
    setSubmitting(true);
    try {
      const completedTrace = await api.runTrace({
        input: requestInput,
        model_id: String(form.get("model")),
        agent_system_id: system.id,
        agent_system_version_id: String(form.get("graphVersion")),
        prompt_version_id: String(form.get("promptVersion")),
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
        title={`Run ${system.name}`}
        description="Execute one request with pinned versions. Every run is recorded as a trace."
      />
      <section className="grid gap-4 p-4 md:p-7 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <form
          className="min-w-0 border border-[var(--border)] bg-[var(--surface)]"
          aria-busy={submitting}
          onSubmit={submit}
        >
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-[12px] font-semibold">Request configuration</h2>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              Select immutable execution inputs, then edit the request payload.
            </p>
          </div>
          <div className="grid gap-5 p-4 md:p-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="field">
                <label htmlFor="run-graph-version">Graph version</label>
                <Select
                  id="run-graph-version"
                  name="graphVersion"
                  disabled={submitting || graphs.length === 0}
                  required
                >
                  {graphs.map((version) => (
                    <option key={version.id} value={version.id}>
                      {system.name} v{version.version}
                    </option>
                  ))}
                </Select>
              </div>
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
            <div className="field">
              <label htmlFor="run-input">Request input (JSON)</label>
              <textarea
                id="run-input"
                className="app-textarea mono min-h-[390px] text-[11px]"
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
                Initialized from this system&apos;s registered input template.
              </p>
            </div>
            {!runnable ? (
              <p
                id="run-error"
                role="alert"
                className="text-[11px] text-[var(--danger)]"
              >
                This system needs at least one graph, prompt, and available
                model before it can run.
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

        <aside
          className="min-w-0 border border-[var(--border)] bg-[var(--surface)]"
          aria-live="polite"
          aria-busy={submitting}
        >
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-[12px] font-semibold">Latest result</h2>
            {trace ? <StatusBadge status={trace.status} /> : null}
          </div>
          {submitting ? (
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
        </aside>
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
