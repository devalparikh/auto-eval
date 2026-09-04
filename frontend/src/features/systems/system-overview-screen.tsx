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
import { CatalogGate } from "@/components/catalog-gate";
import { PageHeader } from "@/components/page-header";
import { systemPath } from "@/features/systems/system-path";

const sections = [
  ["run", "Run", "Send one request through the graph", PlayIcon],
  ["traces", "Traces", "Every run, step by step", PulseIcon],
  ["datasets", "Datasets", "Saved examples to evaluate against", DatabaseIcon],
  [
    "evaluations",
    "Evaluate",
    "Compare models on the same examples",
    FlaskIcon,
  ],
  ["artifacts", "Artifacts", "Graph, prompts, and snapshots", GitBranchIcon],
] as const;

export function SystemOverviewScreen({ systemKey }: { systemKey: string }) {
  return (
    <CatalogGate systemKey={systemKey}>
      {({ catalog, system }) => {
        const datasets = catalog.datasets.filter(
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
                    className="rounded-[var(--radius)] data-row flex min-h-[128px] items-start justify-between gap-5 border border-[var(--border)] bg-[var(--surface)] p-4 no-underline"
                  >
                    <div>
                      <Icon size={16} className="text-[var(--accent)]" />
                      <h2 className="mt-5 text-[13px] font-semibold">
                        {title}
                      </h2>
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
              <aside className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5">
                <p className="mono text-[9px] lowercase tracking-[0.12em] text-[var(--text-faint)]">
                  In this system
                </p>
                <dl className="mt-5 grid gap-4 text-[11px]">
                  <Inventory
                    label="Graph versions"
                    value={system.versions.length}
                  />
                  <Inventory
                    label="Prompts"
                    value={
                      catalog.prompts.filter(
                        (item) => item.agent_system_id === system.id,
                      ).length
                    }
                  />
                  <Inventory label="Datasets" value={datasets.length} />
                  <Inventory
                    label="Dataset versions"
                    value={datasets.reduce(
                      (total, dataset) => total + dataset.versions.length,
                      0,
                    )}
                  />
                </dl>
              </aside>
            </section>
          </>
        );
      }}
    </CatalogGate>
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
