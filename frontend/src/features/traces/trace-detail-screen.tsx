"use client";

import { ArrowLeftIcon, DatabaseIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { AddToDatasetModal } from "@/features/traces/add-to-dataset-modal";
import { SavedInputRefs } from "@/features/systems/saved-input-refs";
import { systemPath } from "@/features/systems/system-path";
import { TraceGraph } from "@/features/traces/trace-graph";
import { TraceInspector } from "@/features/traces/trace-inspector";
import { api } from "@/lib/api";
import { formatCost, formatDuration, shortId, textPreview } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";

export function TraceDetailScreen({
  traceId,
  systemKey,
}: {
  traceId: string;
  systemKey: string;
}) {
  const trace = useApiResource(() => api.trace(traceId), [traceId]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [datasetModalOpen, setDatasetModalOpen] = useState(false);

  const activeNodeId = selectedNodeId ?? trace.data?.spans[0]?.node_id ?? null;
  const activeSpan =
    trace.data?.spans.find((span) => span.node_id === activeNodeId) ?? null;

  if (trace.loading) {
    return (
      <>
        <PageHeader title="Trace" />
        <LoadingState rows={9} />
      </>
    );
  }
  if (trace.error || !trace.data) {
    return (
      <>
        <PageHeader title="Trace" />
        <ErrorState
          message={trace.error ?? "Trace not found"}
          retry={trace.reload}
        />
      </>
    );
  }

  const currentTrace = trace.data;
  return (
    <>
      <PageHeader
        title={`Trace ${shortId(currentTrace.id)}`}
        description={textPreview(currentTrace.request_input)}
        action={
          <button
            className="app-button secondary"
            onClick={() => setDatasetModalOpen(true)}
          >
            <DatabaseIcon size={15} />
            Add to dataset
          </button>
        }
      />
      <section className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 md:px-7">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link
            href={systemPath(systemKey, "traces")}
            className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            <ArrowLeftIcon size={13} />
            All traces
          </Link>
          <StatusBadge status={currentTrace.status} />
          <Metric
            label="Origin"
            value={
              currentTrace.origin_type === "evaluation"
                ? "evaluation"
                : "runtime"
            }
          />
          <Metric
            label="Latency"
            value={formatDuration(currentTrace.latency_ms)}
          />
          <Metric label="Cost" value={formatCost(currentTrace.cost_usd)} />
          <Metric
            label="Tokens"
            value={`${currentTrace.input_tokens + currentTrace.output_tokens}`}
          />
          <Metric
            label="Model"
            value={currentTrace.model_id.split("/").slice(-1)[0]}
          />
          <Metric
            label="Optional capture"
            value={currentTrace.capture_node_outputs ? "on" : "off"}
          />
        </div>
      </section>
      <section className="grid gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 md:grid-cols-2 md:px-7">
        <ProvenanceBlock
          label="Execution origin"
          value={
            currentTrace.origin_type === "evaluation"
              ? `Evaluation ${shortId(currentTrace.evaluation_run_id ?? "unknown")}`
              : "Direct runtime request"
          }
        />
        {Object.keys(currentTrace.node_resource_selections ?? {}).length ? (
          <div className="min-w-0 md:col-span-2">
            <p className="mono text-[9px] lowercase tracking-[0.08em] text-[var(--text-faint)]">
              Saved inputs used
            </p>
            <p className="mt-1 mb-2 text-[10px] text-[var(--text-muted)]">
              This trace stores the exact saved versions used at runtime.
            </p>
            <SavedInputRefs
              systemKey={systemKey}
              selections={currentTrace.node_resource_selections}
            />
          </div>
        ) : null}
        <ProvenanceBlock
          label="Used as a dataset source"
          value={
            currentTrace.dataset_memberships.length
              ? currentTrace.dataset_memberships
                  .map(
                    (membership) =>
                      `${membership.dataset_name}; version: ${membership.dataset_version}; status: ${membership.dataset_version_status}`,
                  )
                  .join("  /  ")
              : "Not used as a dataset source"
          }
        />
      </section>
      <div className="grid min-h-0 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0 border-b border-[var(--border)] xl:border-r xl:border-b-0">
          <div className="flex h-11 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4">
            <h2 className="text-[12px] font-semibold">Execution graph</h2>
            <span className="text-[11px] text-[var(--text-muted)]">
              {currentTrace.spans.length} nodes
            </span>
          </div>
          <TraceGraph
            trace={currentTrace}
            selectedNodeId={activeNodeId}
            onSelect={setSelectedNodeId}
          />
        </section>
        <TraceInspector span={activeSpan} systemKey={systemKey} />
      </div>
      <AddToDatasetModal
        open={datasetModalOpen}
        traceId={currentTrace.id}
        traceInput={currentTrace.request_input}
        traceOutput={currentTrace.output ?? {}}
        runtimeInputSnapshotIds={currentTrace.runtime_input_snapshot_ids}
        nodeResourceSelections={currentTrace.node_resource_selections}
        systemKey={systemKey}
        onClose={() => setDatasetModalOpen(false)}
        onMembershipChanged={async () => {
          trace.setData(await api.trace(traceId));
        }}
      />
    </>
  );
}

function ProvenanceBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="mono text-[9px] lowercase tracking-[0.08em] text-[var(--text-faint)]">
        {label}
      </p>
      <p
        className="mt-1 truncate text-[10px] text-[var(--text-muted)]"
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] text-[var(--text-faint)]">{label}</span>
      <span className="mono text-[11px] font-medium">{value}</span>
    </div>
  );
}
