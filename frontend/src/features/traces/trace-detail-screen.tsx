"use client";

import { ArrowLeftIcon, DatabaseIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { CatalogGate } from "@/components/catalog-gate";
import { PageHeader } from "@/components/page-header";
import { JsonViewer } from "@/components/json-viewer";
import { Select } from "@/components/select";
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
  const definition = trace.data?.graph_definition ?? null;
  const activeNode =
    definition?.nodes.find((node) => node.id === activeNodeId) ?? null;

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
    <CatalogGate systemKey={systemKey}>
      {({ system }) => (
        <>
          <PageHeader
            title={`Trace ${shortId(currentTrace.id)}`}
            description={textPreview(currentTrace.request_input, system.name)}
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
                label="Save live data"
                value={currentTrace.capture_node_outputs === undefined ? "not recorded" : currentTrace.capture_node_outputs ? "enabled for this run" : "off for this run"}
              />
            </div>
          </section>
          <details className="min-w-0 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 md:px-7">
            <summary className="cursor-pointer text-[12px] text-[var(--text-muted)]">Request and run details</summary>
            <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-2">
            <ProvenanceBlock
              label="Started by"
              value={
                currentTrace.origin_type === "evaluation"
                  ? `Evaluation ${shortId(currentTrace.evaluation_run_id ?? "unknown")}`
                  : "A direct request"
              }
            />
            {Object.keys(currentTrace.node_resource_selections ?? {}).length ? (
              <div className="min-w-0 md:col-span-2">
                <p className="mono text-[9px] lowercase tracking-[0.08em] text-[var(--text-faint)]">
                  Saved inputs used
                </p>
                <div className="mt-1.5">
                  <SavedInputRefs
                    systemKey={systemKey}
                    selections={currentTrace.node_resource_selections}
                  />
                </div>
              </div>
            ) : null}
            <ProvenanceBlock
              label="In datasets"
              value={
                currentTrace.dataset_memberships.length
                  ? currentTrace.dataset_memberships
                      .map(
                        (membership) =>
                          `${membership.dataset_name} v${membership.dataset_version} (${membership.dataset_version_status})`,
                      )
                      .join(", ")
                  : "Not in a dataset"
              }
            />
            <div className="min-w-0 md:col-span-2">
              <JsonViewer label="Request input" value={currentTrace.request_input} />
            </div>
            </div>
          </details>
          <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)]">
            <section className="min-w-0 border-b border-[var(--border)]">
              <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
                <h2 className="text-[12px] font-semibold">Execution graph</h2>
                <div className="flex min-w-0 max-w-full items-center gap-2">
                  <label htmlFor="trace-selected-node" className="shrink-0 text-[11px] text-[var(--text-muted)]">Inspect node</label>
                  <Select id="trace-selected-node" className="max-w-[340px]" value={activeNodeId ?? ""} onChange={(event) => setSelectedNodeId(event.target.value)}>
                    {(definition?.nodes ?? currentTrace.spans.map((span) => ({ id: span.node_id, label: span.node_id.replaceAll("_", " ") }))).map((node, index) => <option key={node.id} value={node.id}>{index + 1}. {node.label}</option>)}
                  </Select>
                </div>
              </div>
              <TraceGraph
                trace={currentTrace}
                selectedNodeId={activeNodeId}
                onSelect={setSelectedNodeId}
              />
            </section>
            <TraceInspector
              span={activeSpan}
              node={activeNode}
              entry={
                Boolean(activeNodeId) && definition?.entry_point === activeNodeId
              }
              output={
                Boolean(activeNodeId) && definition?.output_node === activeNodeId
              }
              systemKey={systemKey}
            />
          </div>
          <AddToDatasetModal
            open={datasetModalOpen}
            traceId={currentTrace.id}
            traceInput={currentTrace.request_input}
            traceOutput={currentTrace.output ?? {}}
            runtimeInputSnapshotIds={currentTrace.runtime_input_snapshot_ids}
            nodeResourceSelections={currentTrace.node_resource_selections}
            systemKey={systemKey}
            datasetEditor={system.dataset_editor}
            onClose={() => setDatasetModalOpen(false)}
            onMembershipChanged={async () => {
              trace.setData(await api.trace(traceId));
            }}
          />
        </>
      )}
    </CatalogGate>
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
