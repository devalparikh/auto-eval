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
          <h2 className="text-[13px] font-semibold">Runtime observations</h2>
          <p className="mt-1 text-[10px] leading-5 text-[var(--text-muted)]">
            Immutable external inputs captured at graph nodes. Real records
            expose safe shape metadata; synthetic records may expose normalized
            content.
          </p>
        </div>
      </div>
      {error ? <ErrorState message={error} retry={retry} /> : null}
      {loading && snapshots.length === 0 ? <LoadingState rows={8} /> : null}
      {!loading && !error && snapshots.length === 0 ? (
        <div className="p-5">
          <p className="text-[11px] font-medium">
            No runtime observations recorded
          </p>
          <p className="mt-1 max-w-[54ch] text-[10px] leading-5 text-[var(--text-muted)]">
            Direct runs create an observation when an external-input node
            refreshes successfully.
          </p>
        </div>
      ) : null}
      {snapshots.length || detail ? (
        <div className="grid min-h-[520px] md:grid-cols-[250px_minmax(0,1fr)]">
          <div
            className="border-b border-[var(--border)] md:border-r md:border-b-0"
            aria-label="Runtime observation records"
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
                  <span>{snapshot.is_synthetic ? "synthetic" : "real"}</span>
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
                      aria-label="Runtime observation view"
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
                    <span>Captured content is read-only.</span>
                  </div>
                  {view === "info" ? (
                    <div className="grid gap-4">
                      <dl className="grid gap-4 border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-[11px] md:grid-cols-2">
                        <SnapshotFact
                          label="Observed"
                          value={formatDate(detail.observed_at)}
                        />
                        <SnapshotFact
                          label="Fetched"
                          value={formatDate(detail.fetched_at)}
                        />
                        <SnapshotFact
                          label="Record kind"
                          value={`${detail.source_kind} · ${detail.is_synthetic ? "synthetic" : "real"}`}
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
                            Source trace
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
                              "Synthetic fixture / external import"
                            )}
                          </dd>
                        </div>
                      </dl>
                      <JsonViewer
                        label="Observation provenance"
                        value={detail.provenance}
                      />
                    </div>
                  ) : detail.content_available && detail.content ? (
                    <JsonViewer
                      label={
                        detail.is_synthetic
                          ? "Synthetic observation content"
                          : "Safe observation content"
                      }
                      value={detail.content}
                    />
                  ) : (
                    <div className="border border-[var(--border)] bg-[var(--surface-muted)] p-5">
                      <p className="text-[11px] font-medium">
                        Content is not available
                      </p>
                      <p className="mt-1 text-[10px] leading-5 text-[var(--text-muted)]">
                        Provenance remains visible, but the current reveal
                        policy does not expose this observation payload.
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
