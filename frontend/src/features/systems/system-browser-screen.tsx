"use client";

import { ArrowRightIcon, GitBranchIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { systemPath } from "@/features/systems/system-path";
import { api } from "@/lib/api";
import { useApiResource } from "@/lib/use-api-resource";

export function SystemBrowserScreen() {
  const catalog = useApiResource(api.catalog, []);
  return (
    <>
      <PageHeader
        title="Agent systems"
        description="Each system owns its versions, prompts, traces, datasets, evaluations, and results."
      />
      <section className="grid gap-4 p-4 md:grid-cols-2 md:p-7">
        {catalog.loading ? <LoadingState rows={8} /> : null}
        {catalog.error ? (
          <ErrorState message={catalog.error} retry={catalog.reload} />
        ) : null}
        {!catalog.loading && catalog.data?.agent_systems.length === 0 ? (
          <EmptyState
            title="No agent systems"
            message="Seed a built-in system or register one through the backend extension boundary."
          />
        ) : null}
        {catalog.data?.agent_systems.map((system) => {
          const promptCount = catalog.data?.prompts.filter(
            (prompt) => prompt.agent_system_id === system.id,
          ).length;
          const datasets = catalog.data?.datasets.filter(
            (dataset) => dataset.agent_system_id === system.id,
          );
          return (
            <Link
              key={system.id}
              href={systemPath(system.key)}
              className="data-row group grid min-h-[190px] content-between border border-[var(--border)] bg-[var(--surface)] p-5 no-underline"
            >
              <div>
                <div className="flex items-center justify-between gap-4">
                  <span className="grid size-9 place-items-center border border-[var(--border-strong)] text-[var(--accent)]">
                    <GitBranchIcon size={17} />
                  </span>
                  <ArrowRightIcon
                    size={15}
                    className="data-row-affordance text-[var(--text-faint)]"
                  />
                </div>
                <h2 className="mt-7 text-[17px] font-semibold tracking-[-0.035em]">
                  {system.name}
                </h2>
                <p className="mt-2 max-w-[58ch] text-[11px] leading-5 text-[var(--text-muted)]">
                  {system.description}
                </p>
              </div>
              <p className="mono mt-6 text-[9px] text-[var(--text-faint)]">
                {system.versions.length} graph versions · {promptCount ?? 0} prompts ·{" "}
                {datasets?.length ?? 0} datasets
              </p>
            </Link>
          );
        })}
      </section>
    </>
  );
}
