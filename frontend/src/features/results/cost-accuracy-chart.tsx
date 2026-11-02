"use client";

import { useReducedMotion } from "motion/react";
import {
  CartesianGrid,
  LabelList,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "@/components/states";
import {
  distinctGraphVersions,
  graphVersionOf,
  modelName,
  type ResultRow,
  type VersionNumbers,
} from "@/features/results/result-rows";
import { formatCost, formatDuration, formatPercent, shortId } from "@/lib/format";

type ChartPoint = {
  name: string;
  graphVersion: number | null;
  runId: string;
  cost: number;
  accuracy: number;
  latency: number;
};

const seriesColors = [
  "var(--accent)",
  "var(--node-live)",
  "var(--node-saved)",
  "var(--success)",
  "var(--text-muted)",
];

/**
 * Accuracy against total cost. The shaded region marks the "most attractive
 * quadrant": at least median accuracy for at most median cost.
 */
export function CostAccuracyChart({
  rows,
  numbers,
}: {
  rows: ResultRow[];
  numbers: VersionNumbers;
}) {
  const reduceMotion = useReducedMotion();
  const graphVersions = distinctGraphVersions(rows, numbers);
  const comparesGraphs = graphVersions.length > 1;
  const points: ChartPoint[] = rows.map((row) => ({
    name: comparesGraphs
      ? `${modelName(row.model_id)} · v${graphVersionOf(row, numbers)}`
      : modelName(row.model_id),
    graphVersion: graphVersionOf(row, numbers),
    runId: row.run.id,
    cost: row.metrics.total_cost_usd,
    accuracy: row.metrics.accuracy,
    latency: row.metrics.average_latency_ms,
  }));
  const costs = points.map((point) => point.cost);
  const accuracies = points.map((point) => point.accuracy);
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const costMedian = points.length ? median(costs) : 0;
  const accuracyMedian = points.length ? median(accuracies) : 0;
  const costMax = points.length ? Math.max(...costs) * 1.12 : 1;
  const inQuadrant = points.filter(
    (point) => point.cost <= costMedian && point.accuracy >= accuracyMedian,
  ).length;

  return (
    <div className="min-h-[420px] overflow-hidden surface-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold">Accuracy vs. cost</h2>
          {comparesGraphs ? (
            <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {graphVersions.map((version, index) => (
                <li
                  key={version}
                  className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]"
                >
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full"
                    style={{
                      background: seriesColors[index % seriesColors.length],
                    }}
                  />
                  Graph v{version}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {points.length ? (
          <span className="mono inline-flex items-center gap-2 rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[10px] text-[var(--success)]">
            <span className="status-dot" aria-hidden="true" />
            {inQuadrant} of {points.length} in the attractive quadrant
          </span>
        ) : null}
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
          aria-label="Scatter chart of accuracy by total cost"
        >
          <ResponsiveContainer width="100%" height="100%" debounce={120}>
            <ScatterChart margin={{ top: 18, right: 28, bottom: 22, left: 4 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 4" />
              <ReferenceArea
                x1={0}
                x2={costMedian}
                y1={accuracyMedian}
                y2={1}
                fill="var(--success)"
                fillOpacity={0.1}
                stroke="var(--success)"
                strokeOpacity={0.25}
                strokeDasharray="3 3"
                label={{
                  value: "most attractive quadrant",
                  position: "insideTopLeft",
                  fill: "var(--success)",
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                }}
              />
              <XAxis
                type="number"
                dataKey="cost"
                name="Total cost"
                domain={[0, costMax]}
                tickFormatter={(value: number) => `$${value.toFixed(4)}`}
                tickCount={5}
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
              {(comparesGraphs ? graphVersions : [null]).map(
                (version, index) => (
                  <Scatter
                    key={version ?? "all"}
                    data={
                      comparesGraphs
                        ? points.filter((point) => point.graphVersion === version)
                        : points
                    }
                    fill={seriesColors[index % seriesColors.length]}
                    isAnimationActive={!reduceMotion}
                    animationDuration={520}
                    animationEasing="ease-out"
                  >
                    <LabelList
                      dataKey="name"
                      position="right"
                      offset={10}
                      fill="var(--text)"
                      fontSize={10}
                      fontFamily="var(--font-mono)"
                    />
                  </Scatter>
                ),
              )}
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
    <div className="rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-3 shadow-lg">
      <p className="text-[11px] font-semibold">{point.name}</p>
      <p className="mono mt-1 text-[9px] text-[var(--text-faint)]">
        Run {shortId(point.runId)}
        {point.graphVersion === null ? "" : ` · graph v${point.graphVersion}`}
      </p>
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
