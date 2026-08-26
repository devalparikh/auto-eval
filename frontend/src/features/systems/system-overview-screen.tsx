"use client";

import {
  ArrowRightIcon,
  DatabaseIcon,
  FlaskIcon,
  GitBranchIcon,
  PlayIcon,
  PulseIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingState } from "@/components/states";
import { systemByKey } from "@/features/catalog/catalog-options";
import { systemPath } from "@/features/systems/system-path";
import { api } from "@/lib/api";
import { useApiResource } from "@/lib/use-api-resource";

const sections = [
  ["run", "Run", "Execute one request with pinned versions", PlayIcon],
  ["traces", "Traces", "Runtime and evaluation executions", PulseIcon],
  [
    "datasets",
    "Datasets",
    "Reviewed examples and immutable versions",
    DatabaseIcon,
  ],
  ["evaluations", "Evaluate", "Pinned cross-model runs", FlaskIcon],
  [
    "artifacts",
    "Artifacts",
    "Graph, prompt, and indexed snapshot revisions",
    GitBranchIcon,
  ],
] as const;

export function SystemOverviewScreen({ systemKey }: { systemKey: string }) {
  const catalog = useApiResource(api.catalog, []);
  const system = systemByKey(catalog.data, systemKey);
  if (catalog.loading) return <LoadingState rows={9} />;
  if (catalog.error)
    return <ErrorState message={catalog.error} retry={catalog.reload} />;
  if (!system) return <ErrorState message="Agent system not found" />;
  const datasets = catalog.data?.datasets.filter(
    (dataset) => dataset.agent_system_id === system.id,
  );
  return (
    <>
      <PageHeader title={system.name} description={system.description} />
      <section className="grid gap-4 p-4 md:p-7 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)]">
        <div className="grid gap-3 md:grid-cols-2">
          {sections.map(([section, title, description, Icon]) => (
            <Link
              key={section}
              href={systemPath(systemKey, section)}
              className="data-row flex min-h-[128px] items-start justify-between gap-5 border border-[var(--border)] bg-[var(--surface)] p-4 no-underline"
            >
              <div>
                <Icon size={16} className="text-[var(--accent)]" />
                <h2 className="mt-5 text-[13px] font-semibold">{title}</h2>
                <p className="mt-1 text-[10px] leading-5 text-[var(--text-muted)]">
                  {description}
                </p>
              </div>
              <ArrowRightIcon
                size={14}
                className="data-row-affordance text-[var(--text-faint)]"
              />
            </Link>
          ))}
        </div>
        <aside className="border border-[var(--border)] bg-[var(--surface)] p-5">
          <p className="mono text-[9px] lowercase tracking-[0.12em] text-[var(--text-faint)]">
            Workspace inventory
          </p>
          <dl className="mt-5 grid gap-4 text-[11px]">
            <Inventory label="Graph versions" value={system.versions.length} />
            <Inventory
              label="Prompt families"
              value={
                catalog.data?.prompts.filter(
                  (item) => item.agent_system_id === system.id,
                ).length ?? 0
              }
            />
            <Inventory label="Datasets" value={datasets?.length ?? 0} />
            <Inventory
              label="Dataset versions"
              value={
                datasets?.reduce(
                  (total, dataset) => total + dataset.versions.length,
                  0,
                ) ?? 0
              }
            />
          </dl>
        </aside>
      </section>
    </>
  );
}

function Inventory({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border)] pb-3 last:border-b-0">
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd className="mono font-semibold">{value}</dd>
    </div>
  );
}
