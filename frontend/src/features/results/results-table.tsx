import { ArrowUpRightIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import {
  traceIdForResult,
  type ResultRow,
} from "@/features/results/result-rows";
import {
  formatCost,
  formatDate,
  formatDuration,
  formatPercent,
  shortId,
} from "@/lib/format";

export function ResultsTable({
  rows,
  loading,
  error,
  retry,
}: {
  rows: ResultRow[];
  loading: boolean;
  error: string | null;
  retry: () => Promise<void>;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold">Model comparison</h2>
          <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
            Macro metrics use severity labels.
          </p>
        </div>
        <span className="mono text-[10px] text-[var(--text-muted)]">
          {rows.length} results
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[minmax(160px,1.5fr)_75px_72px_72px_72px_74px_84px_26px] gap-2 border-b border-[var(--border)] px-4 py-2.5 text-[10px] font-semibold text-[var(--text-muted)]">
            <span>Model</span>
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
            return (
              <div
                key={row.id}
                className="data-row grid min-h-[58px] grid-cols-[minmax(160px,1.5fr)_75px_72px_72px_72px_74px_84px_26px] items-center gap-2 border-b border-[var(--border)] px-4 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-semibold">
                    {row.model_id.split("/").slice(-1)[0]}
                  </p>
                  <p className="mono mt-1 text-[9px] text-[var(--text-faint)]">
                    {shortId(row.run.id)} · {formatDate(row.created_at)}
                  </p>
                </div>
                <MetricCell value={formatPercent(row.metrics.accuracy)} strong />
                <MetricCell value={formatPercent(row.metrics.f1_macro)} />
                <MetricCell value={formatPercent(row.metrics.precision_macro)} />
                <MetricCell value={formatPercent(row.metrics.recall_macro)} />
                <MetricCell value={formatCost(row.metrics.total_cost_usd)} />
                <MetricCell value={formatDuration(row.metrics.average_latency_ms)} />
                {traceId ? (
                  <Link
                    href={`/traces/${traceId}`}
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
        </div>
      </div>
    </div>
  );
}

function MetricCell({ value, strong = false }: { value: string; strong?: boolean }) {
  return (
    <span
      className={`mono text-[10px] ${
        strong ? "font-semibold text-[var(--text)]" : "text-[var(--text-muted)]"
      }`}
    >
      {value}
    </span>
  );
}
