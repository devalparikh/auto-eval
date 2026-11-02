import { ArrowUpRightIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { HoverGlide } from "@/components/hover-glide";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import {
  graphVersionDeltas,
  graphVersionOf,
  modelName,
  promptLabel,
  traceIdForResult,
  type ResultDelta,
  type ResultRow,
  type VersionNumbers,
} from "@/features/results/result-rows";
import { systemPath } from "@/features/systems/system-path";
import {
  formatCost,
  formatDate,
  formatDuration,
  formatPercent,
  shortId,
} from "@/lib/format";

const columns =
  "grid-cols-[minmax(160px,1.5fr)_54px_78px_64px_72px_64px_84px_84px_26px]";

export function ResultsTable({
  rows,
  numbers,
  systemKey,
  loading,
  error,
  retry,
}: {
  rows: ResultRow[];
  numbers: VersionNumbers;
  systemKey: string;
  loading: boolean;
  error: string | null;
  retry: () => Promise<void>;
}) {
  const deltas = graphVersionDeltas(rows, numbers);
  return (
    <div className="overflow-hidden surface-card">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-[13px] font-semibold">
          Model and graph comparison
        </h2>
        <span className="mono text-[10px] text-[var(--text-muted)]">
          {rows.length} results
        </span>
      </div>
      <div className="overflow-x-auto">
        <HoverGlide className="min-w-[800px]">
          <div
            className={`grid ${columns} gap-2 border-b border-[var(--border)] px-4 py-2.5 text-[10px] font-semibold text-[var(--text-muted)]`}
          >
            <span>Model</span>
            <span>Graph</span>
            <span>Accuracy</span>
            <span>F1</span>
            <span>Precision</span>
            <span>Recall</span>
            <span>Cost</span>
            <span>Latency</span>
            <span />
          </div>
          {loading ? <LoadingState rows={6} /> : null}
          {error ? <ErrorState message={error} retry={retry} /> : null}
          {!loading && !error && rows.length === 0 ? (
            <EmptyState
              title="No results for this selection"
              message="Run an evaluation using this finalized dataset version."
            />
          ) : null}
          {rows.map((row) => {
            const traceId = traceIdForResult(row);
            const delta = deltas.get(row.id);
            const graphVersion = graphVersionOf(row, numbers);
            const prompts = promptLabel(row.run, numbers);
            return (
              <div
                key={row.id}
                className={`data-row grid min-h-[58px] ${columns} items-center gap-2 border-b border-[var(--border)] px-4 last:border-b-0`}
              >
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-semibold">
                    {modelName(row.model_id)}
                  </p>
                  <p
                    className="mono mt-1 truncate text-[9px] text-[var(--text-faint)]"
                    title={prompts}
                  >
                    {shortId(row.run.id)} · {formatDate(row.created_at)}
                  </p>
                </div>
                <span className="mono text-[10px] text-[var(--text-muted)]" title={prompts}>
                  {graphVersion === null ? "—" : `v${graphVersion}`}
                </span>
                <MetricCell
                  value={formatPercent(row.metrics.accuracy)}
                  strong
                  change={
                    delta && {
                      text: `${signed(delta.accuracyPoints, 1)} pts`,
                      amount: delta.accuracyPoints,
                      higherIsBetter: true,
                      baseline: delta.baselineVersion,
                    }
                  }
                />
                <MetricCell value={formatPercent(row.metrics.f1_macro)} />
                <MetricCell value={formatPercent(row.metrics.precision_macro)} />
                <MetricCell value={formatPercent(row.metrics.recall_macro)} />
                <MetricCell
                  value={formatCost(row.metrics.total_cost_usd)}
                  change={percentChange(delta, delta?.costPercent)}
                />
                <MetricCell
                  value={formatDuration(row.metrics.average_latency_ms)}
                  change={percentChange(delta, delta?.latencyPercent)}
                />
                {traceId ? (
                  <Link
                    href={systemPath(systemKey, `traces/${traceId}`)}
                    aria-label={`Open a trace for ${row.model_id}`}
                    className="data-row-affordance grid size-7 place-items-center rounded-[7px] text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                  >
                    <ArrowUpRightIcon size={13} />
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
        </HoverGlide>
      </div>
    </div>
  );
}

type MetricChange = {
  text: string;
  amount: number;
  higherIsBetter: boolean;
  baseline: number;
};

function signed(value: number, digits: number): string {
  const rounded = value.toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

function percentChange(
  delta: ResultDelta | undefined,
  percent: number | null | undefined,
): MetricChange | undefined {
  if (!delta || percent === null || percent === undefined) return undefined;
  return {
    text: `${signed(percent, 0)}%`,
    amount: percent,
    higherIsBetter: false,
    baseline: delta.baselineVersion,
  };
}

function MetricCell({
  value,
  strong = false,
  change,
}: {
  value: string;
  strong?: boolean;
  change?: MetricChange;
}) {
  const improved = change
    ? change.higherIsBetter === change.amount > 0
    : false;
  return (
    <span className="min-w-0">
      <span
        className={`mono block text-[10px] ${
          strong ? "font-semibold text-[var(--text)]" : "text-[var(--text-muted)]"
        }`}
      >
        {value}
      </span>
      {change && Math.abs(change.amount) >= 0.05 ? (
        <span
          className={`mono mt-0.5 block text-[9px] ${
            improved ? "text-[var(--success)]" : "text-[var(--danger)]"
          }`}
          title={`Compared with graph v${change.baseline}`}
        >
          {change.text}
        </span>
      ) : null}
    </span>
  );
}
