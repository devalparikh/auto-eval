"use client";

import {
  ArrowSquareOutIcon,
  CheckIcon,
  CopyIcon,
  DatabaseIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { StatusBadge } from "@/components/status-badge";
import { systemPath } from "@/features/systems/system-path";
import { api } from "@/lib/api";
import { formatCost, formatDate, formatDuration, shortId } from "@/lib/format";
import type { TraceSpan } from "@/lib/types";
import { useApiResource } from "@/lib/use-api-resource";

export function TraceInspector({
  span,
  systemKey,
}: {
  span: TraceSpan | null;
  systemKey: string;
}) {
  const [copied, setCopied] = useState(false);
  const copyOutput = useCallback(async () => {
    if (!span?.output) return;
    await navigator.clipboard.writeText(JSON.stringify(span.output, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [span]);

  if (!span) {
    return (
      <div className="grid min-h-[360px] place-items-center text-[12px] text-[var(--text-muted)]">
        Select a node
      </div>
    );
  }

  return (
    <aside className="min-w-0 bg-[var(--surface)]">
      <div className="flex h-11 items-center justify-between border-b border-[var(--border)] px-4">
        <h2 className="truncate text-[12px] font-semibold">
          {span.node_id.replaceAll("_", " ")}
        </h2>
        <StatusBadge status={span.status} />
      </div>
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
      <InspectorSection label="Input">
        <JsonBlock value={span.input} />
      </InspectorSection>
      {span.node_snapshot_id || span.runtime_input_snapshot_id ? (
        <NodeSnapshotUse span={span} systemKey={systemKey} />
      ) : span.node_kind === "deterministic" || span.node_kind === "external_input" ? (
        <InspectorSection label="Data resolution">
          <p className="text-[10px] leading-5 text-[var(--text-muted)]">
            Executed for this trace. No immutable node-output snapshot was attached to
            this step.
          </p>
        </InspectorSection>
      ) : null}
      {span.system_prompt ? (
        <InspectorSection label="System prompt">
          <p className="max-h-44 overflow-y-auto whitespace-pre-wrap text-[11px] leading-5 text-[var(--text-muted)]">
            {span.system_prompt}
          </p>
        </InspectorSection>
      ) : null}
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
    </aside>
  );
}

function NodeSnapshotUse({
  span,
  systemKey,
}: {
  span: TraceSpan;
  systemKey: string;
}) {
  const snapshotId = span.node_snapshot_id ?? span.runtime_input_snapshot_id ?? "";
  const detail = useApiResource(
    () =>
      snapshotId
        ? api.nodeSnapshot(snapshotId)
        : Promise.reject(new Error("No node snapshot selected")),
    [snapshotId],
  );
  const mode = span.snapshot_resolution_mode ??
    (span.runtime_input_snapshot_id ? "replayed" : "computed");
  const role = span.snapshot_role ?? (mode === "replayed" ? "consumed" : "produced");
  const label = resolutionLabel(mode, role);

  return (
    <InspectorSection label="Data resolution">
      <div className="border border-[var(--border)]">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-3 py-3">
          <span className="flex min-w-0 items-start gap-2">
            <DatabaseIcon size={13} className="mt-0.5 shrink-0 text-[var(--accent)]" />
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold">{label}</span>
              <span className="mono mt-1 block truncate text-[8px] text-[var(--text-faint)]">
                {span.node_id} → {shortId(snapshotId)}
              </span>
            </span>
          </span>
          <Link
            href={`${systemPath(systemKey, "artifacts")}?snapshot=${encodeURIComponent(snapshotId)}`}
            className="flex shrink-0 items-center gap-1 text-[9px] text-[var(--accent)] hover:underline"
          >
            Open
            <ArrowSquareOutIcon size={10} />
          </Link>
        </div>
        <dl className="grid grid-cols-2 text-[9px]">
          <SnapshotFact label="Role" value={role} />
          <SnapshotFact label="Mode" value={mode} />
          <SnapshotFact label="Step latency" value={formatDuration(span.latency_ms)} />
          <SnapshotFact label="Step status" value={span.status} />
          {detail.data ? (
            <>
              <SnapshotFact label="Observed" value={formatDate(detail.data.observed_at)} />
              <SnapshotFact label="Captured" value={formatDate(detail.data.captured_at)} />
              <SnapshotFact label="Source" value={detail.data.source} />
              <SnapshotFact label="Provider" value={detail.data.provider ?? "local"} />
              <SnapshotFact label="Schema" value={`v${detail.data.schema_version}`} />
              <SnapshotFact
                label="Data class"
                value={detail.data.is_synthetic ? "synthetic" : "real"}
              />
            </>
          ) : null}
        </dl>
        {detail.loading ? (
          <p className="px-3 py-2 text-[9px] text-[var(--text-faint)]">
            Loading snapshot metadata…
          </p>
        ) : null}
        {detail.error ? (
          <p className="px-3 py-2 text-[9px] text-[var(--danger)]">
            Snapshot metadata unavailable: {detail.error}
          </p>
        ) : null}
        {detail.data && Object.keys(detail.data.node_metadata).length ? (
          <details className="border-t border-[var(--border)] px-3 py-2">
            <summary className="cursor-pointer text-[9px] font-medium text-[var(--text-muted)]">
              Node-specific metadata
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
    <div className="min-w-0 border-r border-b border-[var(--border)] px-3 py-2 last:border-r-0">
      <dt className="text-[8px] text-[var(--text-faint)]">{label}</dt>
      <dd className="mono mt-1 truncate text-[9px] text-[var(--text-muted)]">{value}</dd>
    </div>
  );
}

function resolutionLabel(mode: string, role: string): string {
  if (mode === "live") return "Live data captured";
  if (mode === "replayed") return "Snapshot replayed";
  if (mode === "resolved") return "Indexed state resolved";
  if (mode === "seeded") return "Seeded snapshot used";
  return role === "consumed" ? "Snapshot consumed" : "Computed output captured";
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
    <section className="border-b border-[var(--border)] p-4 last:border-b-0">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold text-[var(--text-muted)]">
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
    <pre className="mono max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-[2px] border border-[var(--border)] bg-[var(--canvas)] p-3 text-[10px] leading-5 text-[var(--text-muted)]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
