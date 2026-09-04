"use client";

import { CloudArrowDownIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { JsonViewer } from "@/components/json-viewer";
import { ErrorState, LoadingState } from "@/components/states";
import { systemPath } from "@/features/systems/system-path";
import { formatDate, shortId } from "@/lib/format";
import type {
  RuntimeInputSnapshotDetail,
  RuntimeInputSnapshotSummary,
} from "@/lib/types";

export function RuntimeInputSnapshotArtifact({
  systemKey,
  snapshots,
  selectedSnapshotId,
  onSnapshotChange,
  detail,
  loading,
  error,
  retry,
}: {
  systemKey: string;
  snapshots: RuntimeInputSnapshotSummary[];
  selectedSnapshotId: string;
  onSnapshotChange: (value: string) => void;
  detail: RuntimeInputSnapshotDetail | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}) {
  const [view, setView] = useState<"info" | "content">("info");
  const summary =
    snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? detail;

  return (
    <article className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-start gap-3 border-b border-[var(--border)] px-5 py-4">
        <CloudArrowDownIcon
          size={16}
          className="mt-0.5 shrink-0 text-[var(--accent)]"
        />
        <div>
          <h2 className="text-[13px] font-semibold">Live data snapshots</h2>
          <p className="mt-1 text-[10px] leading-5 text-[var(--text-muted)]">
            Data fetched from outside the app and saved. Real data shows its
            shape only; sample data shows its full content.
          </p>
        </div>
      </div>
      {error ? <ErrorState message={error} retry={retry} /> : null}
      {loading && snapshots.length === 0 ? <LoadingState rows={8} /> : null}
      {!loading && !error && snapshots.length === 0 ? (
        <div className="p-5">
          <p className="text-[11px] font-medium">No live data saved yet</p>
          <p className="mt-1 max-w-[54ch] text-[10px] leading-5 text-[var(--text-muted)]">
            A snapshot is saved here each time a run fetches live data.
          </p>
        </div>
      ) : null}
      {snapshots.length || detail ? (
        <div className="grid min-h-[520px] md:grid-cols-[250px_minmax(0,1fr)]">
          <div
            className="border-b border-[var(--border)] md:border-r md:border-b-0"
            aria-label="Live data snapshots"
          >
            {snapshots.map((snapshot) => (
              <button
                key={snapshot.id}
                type="button"
                aria-pressed={snapshot.id === selectedSnapshotId}
                onClick={() => onSnapshotChange(snapshot.id)}
                className="block w-full border-b border-[var(--border)] px-4 py-3 text-left last:border-b-0 hover:bg-[var(--surface-muted)] aria-pressed:bg-[var(--accent-soft)]"
              >
                <span className="block truncate text-[11px] font-medium">
                  {snapshot.label}
                </span>
                <span className="mono mt-1 block truncate text-[9px] text-[var(--text-muted)]">
                  {snapshot.node_id} · {snapshot.source_key}
                </span>
                <span className="mt-2 flex items-center justify-between gap-2 text-[9px] text-[var(--text-faint)]">
                  <span>{formatDate(snapshot.observed_at)}</span>
                  <span>{snapshot.is_synthetic ? "Sample" : "Real"}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="min-w-0">
            {loading || !summary || !detail ? (
              <LoadingState rows={8} />
            ) : (
              <>
                <div className="grid grid-cols-2 border-b border-[var(--border)] text-[10px] lg:grid-cols-4">
                  <SnapshotMeta label="Source" value={detail.source_key} />
                  <SnapshotMeta label="Node" value={detail.node_id} mono />
                  <SnapshotMeta label="Provider" value={detail.provider} />
                  <SnapshotMeta
                    label="Hash"
                    value={detail.content_hash.slice(0, 10)}
                    mono
                  />
                </div>
                <div className="p-4">
                  <div className="version-view-toolbar">
                    <div
                      className="version-view-switch"
                      aria-label="Snapshot view"
                    >
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
                  {view === "info" ? (
                    <div className="grid gap-4">
                      <dl className="grid gap-4 rounded-[10px] border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-[11px] md:grid-cols-2">
                        <SnapshotFact
                          label="Observed"
                          value={formatDate(detail.observed_at)}
                        />
                        <SnapshotFact
                          label="Fetched"
                          value={formatDate(detail.fetched_at)}
                        />
                        <SnapshotFact
                          label="Data"
                          value={
                            detail.is_synthetic ? "Sample data" : "Real data"
                          }
                        />
                        <SnapshotFact
                          label="Schema version"
                          value={`v${detail.schema_version}`}
                        />
                        <SnapshotFact
                          label="Snapshot ID"
                          value={detail.id}
                          mono
                        />
                        <div>
                          <dt className="text-[9px] text-[var(--text-faint)]">
                            From run
                          </dt>
                          <dd className="mono mt-1 break-all">
                            {detail.source_trace_id ? (
                              <Link
                                className="text-[var(--accent)] underline-offset-2 hover:underline"
                                href={systemPath(
                                  systemKey,
                                  `traces/${detail.source_trace_id}`,
                                )}
                              >
                                {shortId(detail.source_trace_id)}
                              </Link>
                            ) : (
                              "Not from a run"
                            )}
                          </dd>
                        </div>
                      </dl>
                      <JsonViewer
                        label="Where it came from"
                        value={detail.provenance}
                      />
                    </div>
                  ) : detail.content_available && detail.content ? (
                    <JsonViewer
                      label={
                        detail.is_synthetic
                          ? "Saved content"
                          : "Saved content (shape only)"
                      }
                      value={detail.content}
                    />
                  ) : (
                    <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface-muted)] p-5">
                      <p className="text-[11px] font-medium">
                        Content is not available
                      </p>
                      <p className="mt-1 text-[10px] leading-5 text-[var(--text-muted)]">
                        This snapshot shows details only, not its saved content.
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
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
    <div className="border-r border-[var(--border)] px-3 py-2.5 last:border-r-0">
      <p className="text-[var(--text-faint)]">{label}</p>
      <p className={`mt-1 truncate font-medium ${mono ? "mono" : ""}`}>
        {value}
      </p>
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
