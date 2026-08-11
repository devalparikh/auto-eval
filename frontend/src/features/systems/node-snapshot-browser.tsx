"use client";

import {
  BracketsCurlyIcon,
  CloudArrowDownIcon,
  DatabaseIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { JsonViewer } from "@/components/json-viewer";
import { ErrorState, LoadingState } from "@/components/states";
import { systemPath } from "@/features/systems/system-path";
import { formatDate, formatDuration, shortId } from "@/lib/format";
import type {
  NodeSnapshotDetail,
  NodeSnapshotSummary,
} from "@/lib/types";

type InspectorView = "overview" | "metadata" | "content";

export function NodeSnapshotBrowser({
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
  snapshots: NodeSnapshotSummary[];
  selectedSnapshotId: string;
  onSnapshotChange: (snapshotId: string) => void;
  detail: NodeSnapshotDetail | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}) {
  const [requestedNodeKey, setRequestedNodeKey] = useState("");
  const [view, setView] = useState<InspectorView>("overview");
  const groups = useMemo(() => groupSnapshots(snapshots), [snapshots]);
  const selectedSummary =
    snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? snapshots[0];
  const selectedNodeKey = groups.some(
    (group) => group.key === requestedNodeKey,
  )
    ? requestedNodeKey
    : selectedSummary
      ? nodeKey(selectedSummary)
      : groups[0]?.key ?? "";
  const selectedGroup = groups.find((group) => group.key === selectedNodeKey);

  if (error) return <ErrorState message={error} retry={retry} />;
  if (loading && snapshots.length === 0) return <LoadingState rows={10} />;
  if (snapshots.length === 0) {
    return (
      <div className="border border-[var(--border)] bg-[var(--surface)] p-7">
        <p className="text-[12px] font-semibold">No node snapshots recorded</p>
        <p className="mt-1 max-w-[58ch] text-[10px] leading-5 text-[var(--text-muted)]">
          Snapshot-enabled deterministic and external-input nodes will appear here after
          they produce or capture an immutable output.
        </p>
      </div>
    );
  }

  return (
    <section className="overflow-hidden border border-[var(--border)] bg-[var(--surface)]">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
        <div>
          <h2 className="text-[13px] font-semibold">Node snapshots</h2>
          <p className="mt-1 max-w-[68ch] text-[10px] leading-5 text-[var(--text-muted)]">
            Immutable outputs grouped by producing node. Execution latency and replay
            metadata stay attached to each trace usage.
          </p>
        </div>
        <span className="mono text-[9px] text-[var(--text-faint)]">
          {groups.length} nodes · {snapshots.length} snapshots
        </span>
      </header>

      <div className="grid min-h-[620px] lg:grid-cols-[230px_280px_minmax(0,1fr)]">
        <nav
          aria-label="Snapshot-producing nodes"
          className="border-b border-[var(--border)] lg:border-r lg:border-b-0"
        >
          <RailLabel>Deterministic nodes</RailLabel>
          {groups.map((group) => {
            const active = group.key === selectedNodeKey;
            const Icon =
              group.latest.node_kind === "external_input"
                ? CloudArrowDownIcon
                : BracketsCurlyIcon;
            return (
              <button
                key={group.key}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setRequestedNodeKey(group.key);
                  const firstSnapshot = group.snapshots[0];
                  if (firstSnapshot) onSnapshotChange(firstSnapshot.id);
                }}
                className="flex w-full items-start gap-3 border-b border-[var(--border)] px-4 py-3 text-left hover:bg-[var(--surface-muted)] aria-pressed:bg-[var(--accent-soft)]"
              >
                <Icon
                  size={14}
                  className={`mt-0.5 shrink-0 ${active ? "text-[var(--accent)]" : "text-[var(--text-faint)]"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[10px] font-medium">
                    {group.latest.node_label}
                  </span>
                  <span className="mono mt-1 block truncate text-[8px] text-[var(--text-faint)]">
                    {group.latest.flow_name} · {group.latest.node_id}
                  </span>
                  <span className="mt-2 flex items-center justify-between text-[9px] text-[var(--text-muted)]">
                    <span>{group.latest.output_key}</span>
                    <span>{group.snapshots.length}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="border-b border-[var(--border)] lg:border-r lg:border-b-0">
          <RailLabel>Captured outputs</RailLabel>
          <div className="max-h-[620px] overflow-y-auto">
            {(selectedGroup?.snapshots ?? []).map((snapshot) => (
              <button
                key={snapshot.id}
                type="button"
                aria-pressed={snapshot.id === selectedSnapshotId}
                onClick={() => onSnapshotChange(snapshot.id)}
                className="block w-full border-b border-[var(--border)] px-4 py-3 text-left hover:bg-[var(--surface-muted)] aria-pressed:bg-[var(--accent-soft)]"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="truncate text-[10px] font-medium">{snapshot.label}</span>
                  <span className="mono shrink-0 text-[8px] text-[var(--text-faint)]">
                    v{snapshot.schema_version}
                  </span>
                </span>
                <span className="mt-1 block text-[9px] text-[var(--text-muted)]">
                  {formatDate(snapshot.observed_at)}
                </span>
                <span className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[8px] text-[var(--text-faint)]">
                  <span>{snapshot.capture_mode}</span>
                  <span>·</span>
                  <span>{snapshot.is_synthetic ? "synthetic" : "real"}</span>
                  <span>·</span>
                  <span>{snapshot.usage_count} uses</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          {!detail || detail.id !== selectedSnapshotId ? (
            <LoadingState rows={10} />
          ) : (
            <SnapshotInspector
              systemKey={systemKey}
              detail={detail}
              view={view}
              onViewChange={setView}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function SnapshotInspector({
  systemKey,
  detail,
  view,
  onViewChange,
}: {
  systemKey: string;
  detail: NodeSnapshotDetail;
  view: InspectorView;
  onViewChange: (view: InspectorView) => void;
}) {
  return (
    <div>
      <div className="flex items-start gap-3 border-b border-[var(--border)] px-5 py-4">
        <DatabaseIcon size={15} className="mt-0.5 shrink-0 text-[var(--accent)]" />
        <div className="min-w-0">
          <h3 className="truncate text-[12px] font-semibold">{detail.label}</h3>
          <p className="mono mt-1 truncate text-[8px] text-[var(--text-faint)]">
            {detail.id}
          </p>
        </div>
      </div>
      <div className="version-view-toolbar mx-4 mt-4">
        <div className="version-view-switch" aria-label="Snapshot inspector view">
          {(["overview", "metadata", "content"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={view === item}
              onClick={() => onViewChange(item)}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>
        <span>Read-only · {detail.snapshot_kind.replaceAll("_", " ")}</span>
      </div>

      {view === "overview" ? (
        <div className="grid gap-5 p-4">
          <dl className="grid grid-cols-2 border border-[var(--border)] text-[10px] xl:grid-cols-3">
            <Fact label="Observed" value={formatDate(detail.observed_at)} />
            <Fact label="Captured" value={formatDate(detail.captured_at)} />
            <Fact label="Capture mode" value={detail.capture_mode} />
            <Fact label="Source" value={detail.source} />
            <Fact label="Provider" value={detail.provider ?? "local deterministic"} />
            <Fact label="Schema" value={`v${detail.schema_version}`} />
            <Fact label="Flow" value={detail.flow_name} />
            <Fact label="Data class" value={detail.is_synthetic ? "synthetic" : "real"} />
            <Fact label="Hash" value={detail.content_hash.slice(0, 12)} mono />
          </dl>

          <section>
            <h4 className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-faint)]">
              Execution uses
            </h4>
            <div className="mt-2 border border-[var(--border)]">
              {detail.usages.length ? (
                detail.usages.map((usage) => (
                  <Link
                    key={usage.span_id}
                    href={systemPath(
                      usage.agent_system_key || systemKey,
                      `traces/${usage.trace_id}`,
                    )}
                    className="grid gap-2 border-b border-[var(--border)] px-3 py-3 last:border-b-0 hover:bg-[var(--surface-muted)] md:grid-cols-[1fr_auto_auto] md:items-center"
                  >
                    <span>
                      <span className="block text-[10px] font-medium">
                        {usage.role} · {usage.resolution_mode}
                      </span>
                      <span className="mono mt-1 block text-[8px] text-[var(--text-faint)]">
                        trace {shortId(usage.trace_id)}
                      </span>
                    </span>
                    <span className="mono text-[9px] text-[var(--text-muted)]">
                      {formatDuration(usage.latency_ms)}
                    </span>
                    <span className="text-[9px] text-[var(--text-muted)]">
                      {usage.status}
                    </span>
                  </Link>
                ))
              ) : (
                <p className="px-3 py-4 text-[10px] text-[var(--text-muted)]">
                  Seeded or imported snapshot with no recorded trace usage.
                </p>
              )}
            </div>
          </section>
        </div>
      ) : view === "metadata" ? (
        <div className="grid gap-4 p-4">
          <JsonViewer label="Shared provenance" value={detail.provenance} />
          <JsonViewer label="Node-specific metadata" value={detail.node_metadata} />
          {detail.usages[0] ? (
            <JsonViewer label="Latest execution metadata" value={detail.usages[0].metadata} />
          ) : null}
        </div>
      ) : detail.content_available && detail.content ? (
        <div className="p-4">
          <JsonViewer label="Snapshot content" value={detail.content} />
        </div>
      ) : (
        <p className="p-5 text-[10px] leading-5 text-[var(--text-muted)]">
          Snapshot content is hidden by the current reveal policy. Shared and
          node-specific metadata remain available.
        </p>
      )}
    </div>
  );
}

function RailLabel({ children }: { children: string }) {
  return (
    <p className="border-b border-[var(--border)] px-4 py-2.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
      {children}
    </p>
  );
}

function Fact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 border-r border-b border-[var(--border)] px-3 py-2.5">
      <dt className="text-[8px] text-[var(--text-faint)]">{label}</dt>
      <dd className={`mt-1 truncate font-medium ${mono ? "mono" : ""}`}>{value}</dd>
    </div>
  );
}

function nodeKey(snapshot: NodeSnapshotSummary) {
  return `${snapshot.agent_system_key}:${snapshot.node_id}`;
}

function groupSnapshots(snapshots: NodeSnapshotSummary[]) {
  const grouped = new Map<string, NodeSnapshotSummary[]>();
  for (const snapshot of snapshots) {
    const key = nodeKey(snapshot);
    grouped.set(key, [...(grouped.get(key) ?? []), snapshot]);
  }
  return [...grouped.entries()]
    .flatMap(([key, items]) => {
      const latest = items[0];
      return latest ? [{ key, latest, snapshots: items }] : [];
    })
    .sort((left, right) =>
      right.latest.observed_at.localeCompare(left.latest.observed_at),
    );
}
