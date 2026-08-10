"use client";

import { ArrowRightIcon, PlayIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { systemByKey } from "@/features/catalog/catalog-options";
import { systemPath } from "@/features/systems/system-path";
import { api } from "@/lib/api";
import {
  formatCost,
  formatDate,
  formatDuration,
  shortId,
  textPreview,
} from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";

export function TracesScreen({ systemKey }: { systemKey: string }) {
  const catalog = useApiResource(api.catalog, []);
  const system = systemByKey(catalog.data, systemKey);
  const traces = useApiResource(
    () => (system?.id ? api.traces(system.id) : Promise.resolve([])),
    [system?.id],
  );
  return (
    <>
      <PageHeader
        title={`${system?.name ?? "Agent system"} traces`}
        description="Inspect runtime and evaluation executions, node by node."
        action={
          <Link className="app-button" href={systemPath(systemKey, "run")}>
            <PlayIcon size={15} weight="fill" />
            Run inference
          </Link>
        }
      />
      <section className="p-4 md:p-7">
        <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
          <div className="grid grid-cols-[minmax(0,1fr)_110px_90px_96px_36px] gap-3 border-b border-[var(--border)] px-4 py-2.5 text-[11px] font-semibold text-[var(--text-muted)] max-md:grid-cols-[minmax(0,1fr)_74px_28px]">
            <span>Request</span>
            <span className="max-md:hidden">Model</span>
            <span>Status</span>
            <span className="max-md:hidden">Started</span>
            <span aria-hidden="true" />
          </div>
          {traces.loading ? <LoadingState rows={7} /> : null}
          {traces.error ? (
            <ErrorState message={traces.error} retry={traces.reload} />
          ) : null}
          {!traces.loading && !traces.error && traces.data?.length === 0 ? (
            <EmptyState
              title="No traces yet"
              message="Run this agent system to record its node-by-node execution."
            />
          ) : null}
          {traces.data?.map((trace) => (
            <Link
              key={trace.id}
              href={systemPath(systemKey, `traces/${trace.id}`)}
              className="data-row grid min-h-[58px] grid-cols-[minmax(0,1fr)_110px_90px_96px_36px] items-center gap-3 border-b border-[var(--border)] px-4 last:border-b-0 max-md:grid-cols-[minmax(0,1fr)_74px_28px]"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">
                  {textPreview(trace.request_input)}
                </p>
                <p className="mono mt-0.5 text-[10px] text-[var(--text-faint)]">
                  {shortId(trace.id)} · {formatDuration(trace.latency_ms)} ·{" "}
                  {formatCost(trace.cost_usd)}
                  {trace.dataset_membership_count > 0
                    ? ` · ${trace.dataset_membership_count} dataset ${trace.dataset_membership_count === 1 ? "version" : "versions"}`
                    : ""}
                </p>
              </div>
              <div className="truncate text-[11px] text-[var(--text-muted)] max-md:hidden">
                {trace.model_id.split("/").slice(-1)[0]}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={trace.status} />
                  {trace.origin_type === "evaluation" ? (
                    <span className="mono text-[8px] uppercase text-[var(--text-faint)]">
                      Eval
                    </span>
                  ) : null}
                </div>
              </div>
              <time className="text-[11px] text-[var(--text-muted)] max-md:hidden">
                {formatDate(trace.started_at)}
              </time>
              <ArrowRightIcon
                size={14}
                className="data-row-affordance text-[var(--text-faint)]"
              />
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
