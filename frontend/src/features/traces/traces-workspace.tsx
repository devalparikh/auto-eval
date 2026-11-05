"use client";

import { PlayIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { useState, type ReactNode } from "react";
import { HoverGlide } from "@/components/hover-glide";
import {
  SegmentedControl,
  type SegmentedOption,
} from "@/components/segmented-control";
import { SplitPane } from "@/components/split-pane";
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
import { useCatalog } from "@/lib/use-catalog";

type OriginFilter = "all" | "runtime" | "evaluation";

const originFilters: Array<SegmentedOption<OriginFilter>> = [
  { value: "all", label: "All" },
  { value: "runtime", label: "Runs" },
  { value: "evaluation", label: "Evaluations" },
];

/**
 * The list stays mounted while traces change beside it, so its scroll position
 * and filter survive every click.
 */
export function TracesWorkspace({
  systemKey,
  initialCollapsed,
  children,
}: {
  systemKey: string;
  initialCollapsed: boolean;
  children: ReactNode;
}) {
  const selectedTraceId = useSelectedLayoutSegment();
  return (
    <SplitPane
      id="traces"
      label="Trace list"
      initialCollapsed={initialCollapsed}
      narrow={selectedTraceId ? "main" : "pane"}
      pane={
        <TraceList systemKey={systemKey} selectedTraceId={selectedTraceId} />
      }
    >
      <div key={selectedTraceId ?? "none"} className="route-enter">
        {children}
      </div>
    </SplitPane>
  );
}

function TraceList({
  systemKey,
  selectedTraceId,
}: {
  systemKey: string;
  selectedTraceId: string | null;
}) {
  const catalog = useCatalog();
  const system = systemByKey(catalog.data, systemKey);
  const [origin, setOrigin] = useState<OriginFilter>("all");
  const [navigation, setNavigation] = useState({
    from: selectedTraceId,
    pendingId: null as string | null,
  });
  const traces = useApiResource(
    () => (system?.id ? api.traces(system.id) : Promise.resolve([])),
    [system?.id],
    { cacheKey: system?.id ? `traces:${system.id}` : null },
  );

  // Highlight the row on the click itself; the detail follows a moment later.
  if (navigation.from !== selectedTraceId) {
    setNavigation({ from: selectedTraceId, pendingId: null });
  }
  const activeTraceId = navigation.pendingId ?? selectedTraceId;
  const visible = (traces.data ?? []).filter(
    (trace) => origin === "all" || trace.origin_type === origin,
  );
  // Without the catalog there is no system to ask for traces, and the empty
  // list that follows would claim this system has never run.
  const loading = (catalog.loading && !catalog.data) || traces.loading;
  const loadError = catalog.error ?? traces.error;

  return (
    <>
      <header className="split-pane-head">
        <div className="min-w-0">
          <h1 className="split-pane-title">Traces</h1>
          <p className="split-pane-subtitle">
            One record per run. Add useful ones to a dataset.
          </p>
        </div>
        <Link
          className="app-button"
          href={systemPath(systemKey, "run")}
          aria-label="Run inference"
          title="Run inference"
        >
          <PlayIcon size={13} weight="fill" />
          Run
        </Link>
      </header>
      <div className="split-pane-tools">
        <SegmentedControl
          aria-label="Filter traces by origin"
          value={origin}
          onChange={setOrigin}
          options={originFilters}
        />
        <span className="mono text-[10px] text-[var(--text-faint)]">
          {visible.length}
        </span>
      </div>
      <HoverGlide className="split-pane-list" radius={14}>
        {loading ? <LoadingState rows={8} /> : null}
        {!loading && loadError ? (
          <ErrorState
            message={loadError}
            retry={() => {
              void (catalog.error ? catalog.reload() : traces.reload());
            }}
          />
        ) : null}
        {!loading && !loadError && visible.length === 0 ? (
          <EmptyState
            title="No traces here"
            message="Run this agent system to record its node-by-node execution."
          />
        ) : null}
        {visible.map((trace) => {
          const preview = textPreview(trace.request_input, system?.name);
          return (
            <Link
              key={trace.id}
              href={systemPath(systemKey, `traces/${trace.id}`)}
              className="data-row trace-row"
              aria-current={trace.id === activeTraceId ? "page" : undefined}
              onNavigate={() =>
                setNavigation({
                  from: selectedTraceId,
                  pendingId: trace.id,
                })
              }
            >
              <span className="trace-row-head">
                <span className="trace-row-title" title={preview}>
                  {preview}
                </span>
                {trace.status === "complete" ? null : (
                  <StatusBadge status={trace.status} />
                )}
              </span>
              <span className="trace-row-meta">
                <span>{shortId(trace.id)}</span>
                <span>{formatDuration(trace.latency_ms)}</span>
                <span>{formatCost(trace.cost_usd)}</span>
                {trace.origin_type === "evaluation" ? <span>eval</span> : null}
              </span>
              <span className="trace-row-foot">
                <span className="min-w-0 truncate">
                  {trace.model_id.split("/").slice(-1)[0]}
                </span>
                <time>{formatDate(trace.started_at)}</time>
              </span>
            </Link>
          );
        })}
      </HoverGlide>
    </>
  );
}

export function TraceSelectionPrompt({ systemKey }: { systemKey: string }) {
  return (
    <div className="grid min-h-[60dvh] place-items-center px-6 text-center">
      <div>
        <h2 className="text-[15px] font-medium tracking-[-0.02em]">
          Select a trace
        </h2>
        <p className="mt-1.5 max-w-[42ch] text-[12px] leading-5 text-[var(--text-muted)]">
          See each node&rsquo;s input, output, timing, and cost. Add the runs
          worth keeping to a dataset, then benchmark against them.
        </p>
        <Link
          className="app-button secondary mt-4"
          href={systemPath(systemKey, "datasets")}
        >
          Open datasets
        </Link>
      </div>
    </div>
  );
}
