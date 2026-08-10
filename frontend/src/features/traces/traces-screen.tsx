"use client";

import { ArrowRightIcon, PlayIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import {
  RunTraceModal,
  type RunTraceInput,
} from "@/features/traces/run-trace-modal";
import { api } from "@/lib/api";
import {
  formatCost,
  formatDate,
  formatDuration,
  shortId,
  textPreview,
} from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";

export function TracesScreen() {
  const router = useRouter();
  const traces = useApiResource(api.traces, []);
  const catalog = useApiResource(api.catalog, []);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function runTrace(payload: RunTraceInput) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const trace = await api.runTrace({
        input: {
          text: payload.text,
          service: payload.service,
          customer_tier: "standard",
        },
        model_id: payload.modelId,
        agent_system_version_id: payload.graphVersionId,
        prompt_version_id: payload.promptVersionId,
      });
      setModalOpen(false);
      router.push(`/traces/${trace.id}`);
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : "Trace failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Traces"
        description="Inspect every node, inference, and deterministic step."
        action={
          <button className="app-button" onClick={() => setModalOpen(true)}>
            <PlayIcon size={15} weight="fill" />
            Run trace
          </button>
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
          {traces.error ? <ErrorState message={traces.error} retry={traces.reload} /> : null}
          {!traces.loading && !traces.error && traces.data?.length === 0 ? (
            <EmptyState
              title="No traces yet"
              message="Run the seeded incident graph to record its node-by-node execution."
            />
          ) : null}
          {traces.data?.map((trace) => (
            <Link
              key={trace.id}
              href={`/traces/${trace.id}`}
              className="data-row grid min-h-[58px] grid-cols-[minmax(0,1fr)_110px_90px_96px_36px] items-center gap-3 border-b border-[var(--border)] px-4 last:border-b-0 max-md:grid-cols-[minmax(0,1fr)_74px_28px]"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">
                  {textPreview(trace.request_input)}
                </p>
                <p className="mono mt-0.5 text-[10px] text-[var(--text-faint)]">
                  {shortId(trace.id)} · {formatDuration(trace.latency_ms)} ·{" "}
                  {formatCost(trace.cost_usd)}
                </p>
              </div>
              <div className="truncate text-[11px] text-[var(--text-muted)] max-md:hidden">
                {trace.model_id.split("/").slice(-1)[0]}
              </div>
              <div>
                <StatusBadge status={trace.status} />
              </div>
              <time className="text-[11px] text-[var(--text-muted)] max-md:hidden">
                {formatDate(trace.started_at)}
              </time>
              <ArrowRightIcon size={14} className="text-[var(--text-faint)]" />
            </Link>
          ))}
        </div>
      </section>
      <RunTraceModal
        open={modalOpen}
        catalog={catalog.data}
        loading={catalog.loading}
        submitting={submitting}
        error={submitError}
        onClose={() => setModalOpen(false)}
        onSubmit={runTrace}
      />
    </>
  );
}
