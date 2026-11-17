"use client";

import { formatDuration, shortId } from "@/lib/format";
import {
  formatAgo,
  formatMetric,
  formatTimestamp,
  orderedChecks,
  traceDuration,
  type FeedObservation,
} from "./observation-feed";
import styles from "./applications.module.css";

/** How many checks a row shows before folding the rest into a count. */
const VISIBLE_CHECKS = 3;

export function ObservationTable({
  traces,
  selectedId,
  now,
  onOpen,
}: {
  traces: readonly FeedObservation[];
  selectedId: string;
  now: number;
  onOpen: (id: string) => void;
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={`${styles.table} ${styles.traceTable}`}>
        <thead>
          <tr>
            <th>Trace</th>
            <th>Started</th>
            <th>Status</th>
            <th>Checks</th>
            <th>Metrics</th>
            <th>Source</th>
            <th>Experiment</th>
          </tr>
        </thead>
        <tbody>
          {traces.map((trace) => {
            const checks = orderedChecks(trace.checks);
            const duration = traceDuration(trace);
            const metrics = Object.entries(trace.metrics ?? {});
            const selected = trace.id === selectedId;
            return (
              <tr
                key={trace.id}
                className={styles.traceRow}
                data-selected={selected || undefined}
                aria-selected={selected}
              >
                <td>
                  <button
                    type="button"
                    className={styles.traceButton}
                    aria-expanded={selected}
                    onClick={() => onOpen(trace.id)}
                  >
                    <code>{trace.id}</code>
                  </button>
                </td>
                <td className={styles.nowrap}>
                  {typeof trace.startedAt === "number" ? (
                    <time
                      dateTime={new Date(trace.startedAt).toISOString()}
                      title={formatTimestamp(trace.startedAt)}
                    >
                      {formatAgo(trace.startedAt, now)}
                    </time>
                  ) : (
                    <span className={styles.faint}>—</span>
                  )}
                  {duration !== null ? (
                    <span className={`mono ${styles.subline}`}>
                      {formatDuration(duration)}
                    </span>
                  ) : null}
                </td>
                <td>
                  <span
                    className={styles.pill}
                    data-tone={trace.status === "ok" ? "success" : "danger"}
                  >
                    <span className={styles.pillDot} aria-hidden="true" />
                    {trace.status}
                  </span>
                </td>
                <td>
                  {checks.length === 0 ? (
                    <span className={styles.faint}>None declared</span>
                  ) : (
                    <span className={styles.checkList}>
                      {checks.slice(0, VISIBLE_CHECKS).map((check) => (
                        <span
                          key={check.name}
                          className={styles.check}
                          data-result={
                            check.value === null
                              ? "unknown"
                              : check.value
                                ? "pass"
                                : "fail"
                          }
                          title={`${check.name}: ${check.value === null ? "unknown" : check.value ? "pass" : "fail"}`}
                        >
                          {check.value === null ? "?" : check.value ? "✓" : "✕"}{" "}
                          {check.name}
                        </span>
                      ))}
                      {checks.length > VISIBLE_CHECKS ? (
                        <span className={styles.faint}>
                          +{checks.length - VISIBLE_CHECKS}
                        </span>
                      ) : null}
                    </span>
                  )}
                </td>
                <td>
                  {metrics.length === 0 ? (
                    <span className={styles.faint}>—</span>
                  ) : (
                    <dl className={styles.metricList}>
                      {metrics.map(([name, value]) => (
                        <div key={name}>
                          <dt>{name}</dt>
                          <dd className="mono">{formatMetric(name, value)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </td>
                <td>{trace.source}</td>
                <td>
                  <code title={trace.experimentId}>
                    {shortId(trace.experimentId)}
                  </code>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
