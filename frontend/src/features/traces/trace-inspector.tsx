"use client";

import {
  ArrowSquareOutIcon,
  CheckIcon,
  CopyIcon,
  DatabaseIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { StatusBadge } from "@/components/status-badge";
import {
  GraphNodeDetails,
  GraphNodeDetailsEmpty,
} from "@/features/graph/node-details";
import { graphNodeView } from "@/features/graph/node-view";
import { snapshotUse } from "@/features/traces/snapshot-use";
import { systemPath } from "@/features/systems/system-path";
import { api } from "@/lib/api";
import { formatCost, formatDate, formatDuration } from "@/lib/format";
import type { GraphNodeDefinition, TraceSpan } from "@/lib/types";
import { useApiResource } from "@/lib/use-api-resource";

export function TraceInspector({
  span,
  node,
  entry = false,
  output = false,
  systemKey,
}: {
  span: TraceSpan | null;
  node: GraphNodeDefinition | null;
  entry?: boolean;
  output?: boolean;
  systemKey: string;
}) {
  const [copied, setCopied] = useState(false);
  const copyOutput = useCallback(async () => {
    if (!span?.output) return;
    await navigator.clipboard.writeText(JSON.stringify(span.output, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [span]);
  const view = useMemo(
    () =>
      span
        ? graphNodeView(node ?? definitionFromSpan(span), { entry, output })
        : null,
    [entry, node, output, span],
  );

  if (!span || !view) {
    return (
      <div className="grid min-h-[360px] place-items-center bg-[var(--surface)]">
        <GraphNodeDetailsEmpty message="Select a node to see what it did." />
      </div>
    );
  }

  const usage = snapshotUse(span, node);
  return (
    <GraphNodeDetails view={view} configurationCollapsed action={<StatusBadge status={span.status} />}>
      <div className="grid grid-cols-3 border-b border-[var(--border)]">
        <InspectorMetric
          label="Latency"
          value={formatDuration(span.latency_ms)}
        />
        <InspectorMetric label="Cost" value={formatCost(span.cost_usd)} />
        <InspectorMetric
          label="Tokens"
          value={`${span.input_tokens + span.output_tokens}`}
        />
      </div>
      {span.node_snapshot_id || span.runtime_input_snapshot_id ? (
        <NodeSnapshotUse key={span.node_snapshot_id ?? span.runtime_input_snapshot_id} span={span} systemKey={systemKey} />
      ) : usage ? (
        <InspectorSection label="Data used in this execution">
          <p className="text-[13px] font-medium">
            {usage.label}
          </p>
          <p className="mt-1 max-w-[80ch] text-[12px] leading-5 text-[var(--text-muted)]">{usage.detail}</p>
          {span.snapshot_metadata &&
          Object.keys(span.snapshot_metadata).length ? (
            <details className="mt-2 rounded-[8px] border border-[var(--border)] px-3 py-2">
              <summary className="cursor-pointer text-[9px] font-medium text-[var(--text-muted)]">
                Observation details
              </summary>
              <div className="mt-2">
                <JsonBlock value={span.snapshot_metadata} />
              </div>
            </details>
          ) : null}
        </InspectorSection>
      ) : null}
      {span.error ? <p role="alert" className="border-b border-[var(--border)] p-4 text-[12px] text-[var(--danger)] [overflow-wrap:anywhere]">{span.error}</p> : null}
      <div className="grid min-w-0 lg:grid-cols-2">
      <InspectorSection label="Input">
        <JsonBlock value={span.input} />
      </InspectorSection>
      <InspectorSection
        label="Output"
        action={
          <button
            onClick={copyOutput}
            className="flex items-center gap-1 text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            {copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
            {copied ? "Copied" : "Copy"}
          </button>
        }
      >
        <JsonBlock value={span.output ?? {}} />
      </InspectorSection>
      </div>
      {span.system_prompt ? (
        <details className="min-w-0 border-t border-[var(--border)] p-4">
          <summary className="cursor-pointer text-[12px] font-medium text-[var(--text-muted)]">System prompt</summary>
          <p className="mt-3 whitespace-pre-wrap text-[12px] leading-6 text-[var(--text-muted)] [overflow-wrap:anywhere]">
            {span.system_prompt}
          </p>
        </details>
      ) : null}
    </GraphNodeDetails>
  );
}

/** Stand-in node when a trace predates the graph definition it ran on. */
function definitionFromSpan(span: TraceSpan): GraphNodeDefinition {
  return {
    id: span.node_id,
    label: span.node_id.replaceAll("_", " "),
    kind: span.node_kind === "llm" ? "llm" : "deterministic",
    handler: span.node_id,
    task: null,
  };
}

function NodeSnapshotUse({
  span,
  systemKey,
}: {
  span: TraceSpan;
  systemKey: string;
}) {
  const snapshotId =
    span.node_snapshot_id ?? span.runtime_input_snapshot_id ?? "";
  const detail = useApiResource(
    snapshotId ? () => api.nodeSnapshot(snapshotId) : null,
    [snapshotId],
  );
  const usage = snapshotUse(span, null)!;

  return (
    <InspectorSection label="Data used in this execution">
      <div className="border border-[var(--border)]">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-3 py-3">
          <span className="flex min-w-0 items-start gap-2">
            <DatabaseIcon
              size={13}
              className="mt-0.5 shrink-0 text-[var(--accent)]"
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">
                {usage.label}
              </span>
              <span className="mt-1 block text-[12px] leading-5 text-[var(--text-muted)]">{usage.detail}</span>
              <span className="mono mt-2 block text-[11px] text-[var(--text-muted)] [overflow-wrap:anywhere]">
                {snapshotId}
              </span>
            </span>
          </span>
          <Link
            href={`${systemPath(systemKey, "artifacts")}?snapshot=${encodeURIComponent(snapshotId)}`}
            className="flex shrink-0 items-center gap-1 text-[9px] text-[var(--accent)] hover:underline"
          >
            Open snapshot
            <ArrowSquareOutIcon size={10} />
          </Link>
        </div>
        {detail.data ? (
          <dl className="grid grid-cols-3 text-[9px]">
            <SnapshotFact
              label="Captured"
              value={formatDate(detail.data.captured_at)}
            />
            <SnapshotFact
              label="Source"
              value={
                detail.data.provider
                  ? `${detail.data.source} via ${detail.data.provider}`
                  : detail.data.source
              }
            />
            <SnapshotFact
              label="Observed"
              value={detail.data.observed_at ? formatDate(detail.data.observed_at) : "Not recorded"}
            />
          </dl>
        ) : null}
        {detail.loading ? (
          <p className="px-3 py-2 text-[9px] text-[var(--text-faint)]">
            Loading snapshot…
          </p>
        ) : null}
        {detail.error ? (
          <p className="px-3 py-2 text-[9px] text-[var(--danger)]">
            Snapshot details unavailable: {detail.error}
          </p>
        ) : null}
        {detail.data && Object.keys(detail.data.node_metadata).length ? (
          <details className="border-t border-[var(--border)] px-3 py-2">
            <summary className="cursor-pointer text-[9px] font-medium text-[var(--text-muted)]">
              Snapshot metadata
            </summary>
            <div className="mt-2">
              <JsonBlock value={detail.data.node_metadata} />
            </div>
          </details>
        ) : null}
      </div>
    </InspectorSection>
  );
}

function SnapshotFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-r border-[var(--border)] px-3 py-2 last:border-r-0">
      <dt className="text-[10px] text-[var(--text-faint)]">{label}</dt>
      <dd
        className="mono mt-1 text-[11px] text-[var(--text-muted)] [overflow-wrap:anywhere]"
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function InspectorMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-[var(--border)] px-3 py-3 last:border-r-0">
      <p className="text-[9px] text-[var(--text-faint)]">{label}</p>
      <p className="mono mt-1 text-[11px] font-semibold">{value}</p>
    </div>
  );
}

function InspectorSection({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 border-b border-[var(--border)] p-4 last:border-b-0">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[12px] font-medium text-[var(--text-muted)]">
          {label}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function JsonBlock({ value }: { value: Record<string, unknown> }) {
  return (
    <pre tabIndex={0} className="mono max-h-[480px] min-w-0 max-w-full overflow-y-auto whitespace-pre-wrap rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] p-3 text-[12px] leading-6 text-[var(--text-muted)] [overflow-wrap:anywhere]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
