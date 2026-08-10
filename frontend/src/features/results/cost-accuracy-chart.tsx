"use client";

import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "@/components/states";
import type { ResultRow } from "@/features/results/result-rows";
import { formatCost, formatDuration, formatPercent } from "@/lib/format";

type ChartPoint = {
  name: string;
  cost: number;
  accuracy: number;
  latency: number;
};

export function CostAccuracyChart({ rows }: { rows: ResultRow[] }) {
  const points: ChartPoint[] = rows.map((row) => ({
    name: row.model_id.split("/").slice(-1)[0],
    cost: row.metrics.total_cost_usd,
    accuracy: row.metrics.accuracy,
    latency: row.metrics.average_latency_ms,
  }));

  return (
    <div className="min-h-[420px] overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-[13px] font-semibold">Cost and accuracy</h2>
        <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
          Lower cost and higher accuracy define the efficient frontier.
        </p>
      </div>
      {points.length === 0 ? (
        <EmptyState
          title="No points to plot"
          message="Choose a dataset with completed evaluation results."
        />
      ) : (
        <div
          className="h-[360px] p-3"
          role="img"
          aria-label="Scatter chart of total cost by accuracy"
        >
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 18, right: 18, bottom: 22, left: 4 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 4" />
              <XAxis
                type="number"
                dataKey="cost"
                name="Total cost"
                tick={{ fill: "var(--text-muted)", fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: "var(--border-strong)" }}
                label={{
                  value: "Total cost (USD)",
                  position: "insideBottom",
                  offset: -12,
                  fill: "var(--text-muted)",
                  fontSize: 10,
                }}
              />
              <YAxis
                type="number"
                dataKey="accuracy"
                name="Accuracy"
                domain={[0, 1]}
                tickFormatter={(value) => `${Math.round(value * 100)}%`}
                tick={{ fill: "var(--text-muted)", fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: "var(--border-strong)" }}
                width={38}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ stroke: "var(--border-strong)", strokeDasharray: "3 4" }}
              />
              <Scatter data={points} fill="var(--accent)" isAnimationActive />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-3 shadow-lg">
      <p className="text-[11px] font-semibold">{point.name}</p>
      <p className="mono mt-2 text-[10px] text-[var(--text-muted)]">
        Accuracy {formatPercent(point.accuracy)}
      </p>
      <p className="mono mt-1 text-[10px] text-[var(--text-muted)]">
        Cost {formatCost(point.cost)}
      </p>
      <p className="mono mt-1 text-[10px] text-[var(--text-muted)]">
        Latency {formatDuration(point.latency)}
      </p>
    </div>
  );
}
