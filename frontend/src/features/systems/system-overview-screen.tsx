"use client";

import { ArrowRightIcon, CheckIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { CatalogGate } from "@/components/catalog-gate";
import { HarnessScreen } from "@/features/harnesses/harness-screen";
import { PageHeader } from "@/components/page-header";
import { finalDatasetVersions } from "@/features/catalog/catalog-options";
import { AgentGraph } from "@/features/systems/agent-graph";
import { systemPath } from "@/features/systems/system-path";
import { api } from "@/lib/api";
import { countOf } from "@/lib/format";
import type { AgentSystemSummary, Catalog } from "@/lib/types";
import { useApiResource } from "@/lib/use-api-resource";

export function SystemOverviewScreen({ systemKey }: { systemKey: string }) {
  return (
    <CatalogGate systemKey={systemKey}>
      {({ catalog, system }) =>
        system.runtime === "external_harness" ? (
          <HarnessScreen systemKey={systemKey} />
        ) : (
          <>
            <PageHeader title={system.name} description={system.description} />
            <div className="grid gap-4 p-4 md:p-7">
              <SystemWorkflow
                key={system.id}
                catalog={catalog}
                system={system}
                systemKey={systemKey}
              />
              <LatestGraph key={`graph-${system.id}`} system={system} />
            </div>
          </>
        )
      }
    </CatalogGate>
  );
}

function SystemWorkflow({
  catalog,
  system,
  systemKey,
}: {
  catalog: Catalog;
  system: AgentSystemSummary;
  systemKey: string;
}) {
  const traces = useApiResource(() => api.traces(system.id), [system.id], {
    cacheKey: `traces:${system.id}`,
  });
  const finalVersions = finalDatasetVersions(catalog, systemKey);
  const newestFinal = finalVersions[0]?.version.id;
  const runsQuery = newestFinal
    ? `?${new URLSearchParams({ dataset_version_id: newestFinal })}`
    : "";
  const runs = useApiResource(
    () => (runsQuery ? api.evalRuns(runsQuery) : Promise.resolve([])),
    [runsQuery],
    { cacheKey: runsQuery ? `eval-runs:${runsQuery}` : null },
  );

  const caseCount = catalog.datasets
    .filter((dataset) => dataset.agent_system_id === system.id)
    .flatMap((dataset) => dataset.versions)
    .reduce((total, version) => total + version.item_count, 0);
  const traceCount = traces.data?.length ?? 0;
  const runCount = runs.data?.length ?? 0;
  const resultCount =
    runs.data?.filter((run) => run.results.length > 0).length ?? 0;
  const known = traces.data !== null && runs.data !== null;

  const steps = [
    {
      section: "run",
      title: "Run the agent",
      detail: "Send a request. Every node is recorded as a trace.",
      status: known ? countOf(traceCount, "trace") : "",
      done: traceCount > 0,
    },
    {
      section: "datasets",
      title: "Lock real cases",
      detail: "Save good traces with their expected answer, then finalize.",
      status: finalVersions.length
        ? `${finalVersions.length} finalized`
        : caseCount
          ? `${countOf(caseCount, "case")} in draft`
          : "",
      done: finalVersions.length > 0,
    },
    {
      section: "evaluations",
      title: "Benchmark a change",
      detail: "Score graph versions and models on the same locked cases.",
      status: known && runCount ? countOf(runCount, "run") : "",
      done: runCount > 0,
    },
    {
      section: "results",
      title: "Compare results",
      detail: "See what improved quality, cost, and latency.",
      status: "",
      done: resultCount > 0,
    },
  ];
  const nextIndex = known ? steps.findIndex((step) => !step.done) : -1;

  return (
    <section aria-label="Workflow">
      <ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step.section} className="min-w-0">
            <Link
              href={systemPath(systemKey, step.section)}
              className="workflow-step lift surface-card"
              data-next={index === nextIndex}
            >
              <span className="workflow-step-mark" data-done={step.done}>
                {step.done ? <CheckIcon size={11} weight="bold" /> : index + 1}
              </span>
              <span className="workflow-step-title">{step.title}</span>
              <span className="workflow-step-detail">{step.detail}</span>
              <span className="workflow-step-status">
                {index === nextIndex ? (
                  <>
                    Next <ArrowRightIcon size={11} aria-hidden="true" />
                  </>
                ) : (
                  step.status
                )}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {known && nextIndex === -1 ? (
        <p className="mt-3 text-[12px] text-[var(--text-muted)]">
          Change the graph or a prompt in{" "}
          <Link
            className="underline underline-offset-4"
            href={systemPath(systemKey, "artifacts")}
          >
            Graph &amp; prompts
          </Link>
          , then benchmark again.
        </p>
      ) : null}
    </section>
  );
}

function LatestGraph({ system }: { system: AgentSystemSummary }) {
  const latest = system.versions[0];
  const graph = useApiResource(
    latest ? () => api.agentVersion(latest.id) : null,
    [latest?.id],
    { cacheKey: latest ? `graph-version:${latest.id}` : null },
  );
  if (!graph.data) return null;
  return (
    <section className="surface-card min-w-0 p-4">
      <h2 className="mb-3 text-[13px] font-semibold">
        Graph <span className="mono font-normal">v{latest?.version}</span>
      </h2>
      <AgentGraph definition={graph.data.definition} />
    </section>
  );
}
