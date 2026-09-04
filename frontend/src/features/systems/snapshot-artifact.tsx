"use client";

import { useState } from "react";
import { JsonViewer } from "@/components/json-viewer";
import { Select } from "@/components/select";
import { ErrorState, LoadingState } from "@/components/states";
import { formatDate } from "@/lib/format";
import type {
  PortfolioSnapshotDetail,
  PortfolioSnapshotSummary,
} from "@/lib/types";

export function SnapshotArtifact({
  snapshots,
  selectedSnapshotId,
  onSnapshotChange,
  detail,
  loading,
  error,
  retry,
}: {
  snapshots: PortfolioSnapshotSummary[];
  selectedSnapshotId: string;
  onSnapshotChange: (value: string) => void;
  detail: PortfolioSnapshotDetail | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}) {
  const [view, setView] = useState<"info" | "content">("info");
  const summary =
    snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? detail;
  return (
    <article className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
        <div>
          <h2 className="text-[13px] font-semibold">Portfolio state</h2>
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">
            Portfolio contents saved by the Index flow.
          </p>
        </div>
        <Select
          aria-label="Portfolio state snapshot"
          containerClassName="version-select"
          value={selectedSnapshotId}
          disabled={snapshots.length === 0}
          onChange={(event) => onSnapshotChange(event.target.value)}
        >
          {snapshots.length === 0 ? (
            <option value="">No snapshots available</option>
          ) : null}
          {snapshots.map((snapshot) => (
            <option key={snapshot.id} value={snapshot.id}>
              {snapshot.label}
            </option>
          ))}
        </Select>
      </div>
      {summary ? (
        <div className="grid grid-cols-2 border-b border-[var(--border)] text-[10px] md:grid-cols-4">
          <SnapshotMeta label="As of" value={formatDate(summary.as_of)} />
          <SnapshotMeta
            label="Positions"
            value={String(summary.position_count)}
          />
          <SnapshotMeta
            label="Data"
            value={summary.is_synthetic ? "Sample data" : "Real data"}
          />
          <SnapshotMeta
            label="Hash"
            value={summary.content_hash.slice(0, 10)}
            mono
          />
        </div>
      ) : null}
      <div className="p-4">
        <div className="version-view-toolbar">
          <div className="version-view-switch" aria-label="Snapshot view">
            <button
              type="button"
              aria-pressed={view === "info"}
              onClick={() => setView("info")}
            >
              Info
            </button>
            <button
              type="button"
              aria-pressed={view === "content"}
              onClick={() => setView("content")}
            >
              Content
            </button>
          </div>
          <span>Read-only</span>
        </div>
        {loading ? (
          <LoadingState rows={7} />
        ) : error ? (
          <ErrorState message={error} retry={retry} />
        ) : !detail ? (
          <p className="p-5 text-[11px] text-[var(--text-muted)]">
            Index a portfolio to create the first snapshot.
          </p>
        ) : view === "info" ? (
          <dl className="grid gap-4 rounded-[10px] border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-[11px] md:grid-cols-2">
            <SnapshotFact label="Snapshot ID" value={detail.id} mono />
            <SnapshotFact
              label="Schema version"
              value={`v${detail.schema_version}`}
            />
            <SnapshotFact
              label="Created"
              value={formatDate(detail.created_at)}
            />
            <SnapshotFact
              label="From run"
              value={detail.source_trace_id ?? "Not from a run"}
              mono={Boolean(detail.source_trace_id)}
            />
          </dl>
        ) : detail.content_available && detail.content ? (
          <JsonViewer label="Snapshot content" value={detail.content} />
        ) : (
          <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface-muted)] p-5">
            <p className="text-[11px] font-medium">Content is not available</p>
            <p className="mt-1 text-[10px] leading-5 text-[var(--text-muted)]">
              This snapshot shows details only, not its saved content.
            </p>
          </div>
        )}
      </div>
    </article>
  );
}

function SnapshotMeta({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="border-r border-[var(--border)] px-4 py-2.5 last:border-r-0">
      <p className="text-[var(--text-faint)]">{label}</p>
      <p className={`mt-1 font-medium ${mono ? "mono" : ""}`}>{value}</p>
    </div>
  );
}

function SnapshotFact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[9px] text-[var(--text-faint)]">{label}</dt>
      <dd className={`mt-1 break-all ${mono ? "mono" : ""}`}>{value}</dd>
    </div>
  );
}
