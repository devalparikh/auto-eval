"use client";

import {
  ArrowRightIcon,
  GitBranchIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { HoverGlide } from "@/components/hover-glide";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { systemPath } from "@/features/systems/system-path";
import { countOf } from "@/lib/format";
import type { AgentSystemSummary } from "@/lib/types";
import { useCatalog } from "@/lib/use-catalog";

export function SystemBrowserScreen() {
  const catalog = useCatalog();
  const products = Object.values(
    (catalog.data?.agent_systems ?? []).reduce<
      Record<string, AgentSystemSummary[]>
    >((grouped, system) => {
      (grouped[system.product_key] ??= []).push(system);
      return grouped;
    }, {}),
  );
  return (
    <>
      <PageHeader
        title="Agent systems"
        action={
          <Link className="app-button" href="/import">
            <UploadSimpleIcon size={14} />
            Import system
          </Link>
        }
      />
      {/* States sit outside the card grid so they span the page instead of
          taking one column of it. */}
      {catalog.loading && !catalog.data ? <LoadingState rows={8} /> : null}
      {catalog.error ? (
        <ErrorState
          message={catalog.error}
          retry={catalog.reload}
          className="mx-[var(--page-gutter)] mt-5"
        />
      ) : null}
      {!catalog.loading && catalog.data?.agent_systems.length === 0 ? (
        <EmptyState
          title="No agent systems"
          message="Import a system from a folder or GitHub repository to start your first run."
        />
      ) : null}
      <section className="grid gap-4 p-4 empty:hidden md:grid-cols-2 md:p-7">
        {products.map((flows) => {
          const product =
            flows.find((flow) => flow.key === flow.product_key) ?? flows[0];
          const systemIds = new Set(flows.map((flow) => flow.id));
          const promptCount = catalog.data?.prompts.filter((prompt) =>
            systemIds.has(prompt.agent_system_id),
          ).length;
          const datasetCount = catalog.data?.datasets.filter((dataset) =>
            systemIds.has(dataset.agent_system_id),
          ).length;
          const graphVersionCount = flows.reduce(
            (total, flow) => total + flow.versions.length,
            0,
          );
          return (
            <article
              key={product.product_key}
              className="surface-card grid min-h-[190px] content-between p-5"
            >
              <div>
                <div className="flex items-center justify-between gap-4">
                  <span className="grid size-9 place-items-center rounded-[12px] bg-[var(--card-inset)] text-[var(--text-muted)]">
                    <GitBranchIcon size={17} />
                  </span>
                  <span className="mono text-[9px] text-[var(--text-faint)]">
                    {countOf(flows.length, "flow")}
                  </span>
                </div>
                <h2 className="mt-7 text-[17px] font-medium tracking-[-0.035em]">
                  {product.name}
                </h2>
                <p className="mt-2 max-w-[58ch] text-[11px] leading-5 text-[var(--text-muted)]">
                  {product.description}
                </p>
                <HoverGlide className="mt-5 grid gap-1" radius={12}>
                  {flows
                    .toSorted((left, right) =>
                      left.flow_key.localeCompare(right.flow_key),
                    )
                    .map((flow) => (
                      <Link
                        key={flow.id}
                        href={systemPath(flow.key)}
                        className="data-row group flex items-center justify-between rounded-[12px] px-3 py-2 no-underline"
                      >
                        <span className="text-[11px] font-medium">
                          {flow.flow_name}
                        </span>
                        <ArrowRightIcon
                          size={13}
                          className="data-row-affordance text-[var(--text-faint)]"
                        />
                      </Link>
                    ))}
                </HoverGlide>
              </div>
              <p className="mono mt-6 text-[9px] text-[var(--text-faint)]">
                {countOf(graphVersionCount, "graph version")} ·{" "}
                {countOf(promptCount ?? 0, "prompt")} ·{" "}
                {countOf(datasetCount ?? 0, "dataset")}
              </p>
            </article>
          );
        })}
      </section>
    </>
  );
}
