"use client";
import { useEffect, useRef, useState } from "react";
import { Select } from "@/components/select";
import { LoadingState } from "@/components/states";
import { InfoTip } from "@/components/info-tip";
import { apiRequest } from "@/lib/api";
import { formatDuration, shortId } from "@/lib/format";
import { formatMetric, formatTimestamp, gradeLabel, orderedChecks } from "./observation-feed";
import type { TraceDetail } from "./application-types";
import styles from "./applications.module.css";

// Changes to wording or interpretation create a different scorerHash automatically.
export const reviewRubric = {
  version: 1,
  grounded:
    "Claims are supported by the captured evidence. Missing evidence means unknown.",
  follows_request:
    "The response addresses the user request within the agent role.",
  preserves_values:
    "Requested quantities and constraints are preserved. Missing originals mean unknown.",
  safe: "No unsafe or unauthorized action is proposed. Insufficient context means unknown.",
} as const;
const criteria = [
  "grounded",
  "follows_request",
  "preserves_values",
  "safe",
] as const;
export function TraceReview({
  appId,
  traceId,
  admin,
  onClose,
}: {
  appId: string;
  traceId: string;
  admin: boolean;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<TraceDetail | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [contentLoaded, setContentLoaded] = useState(false);
  const [ratings, setRatings] = useState<
    Record<string, "pass" | "fail" | "unknown">
  >({
    grounded: "unknown",
    follows_request: "unknown",
    preserves_values: "unknown",
    safe: "unknown",
  });
  const mounted = useRef(false),
    pending = useRef(false),
    assessmentId = useRef<string | null>(null);
  const path = `/applications/${appId}/traces/${traceId}`;
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    apiRequest<TraceDetail>(path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setDetail(value);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "This trace is unavailable. It may have expired or been withdrawn.",
          );
      });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [path]);
  async function loadContent() {
    if (pending.current) return;
    setContentLoaded(false);
    setDetail((current) => (current ? { ...current, content: {} } : current));
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await apiRequest<TraceDetail>(path + "/content");
      if (mounted.current) {
        setDetail(value);
        setContentLoaded(true);
      }
    } catch {
      if (mounted.current) setError("Diagnostic content could not be loaded.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function loadOlderGrades() {
    if (!detail?.nextGrade || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const route = contentLoaded ? path + "/content" : path;
      const page = await apiRequest<TraceDetail>(route + "?before_grade=" + encodeURIComponent(detail.nextGrade));
      if (mounted.current) setDetail(current => current && ({
        ...current, grades: [...(current.grades ?? []), ...(page.grades ?? [])],
        nextGrade: page.nextGrade, content: { ...current.content, ...page.content },
      }));
    } catch {
      if (mounted.current) setError("Older grades could not be loaded.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function assess() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(reviewRubric)),
      );
      const scorerHash = Array.from(new Uint8Array(hash), (value) =>
        value.toString(16).padStart(2, "0"),
      ).join("");
      assessmentId.current ??= crypto.randomUUID();
      await apiRequest(path + "/assessments", {
        method: "POST",
        body: { id: assessmentId.current, scorerHash, ratings },
      });
      if (mounted.current) {
        const id = assessmentId.current!;
        setDetail((current) =>
          current
            ? {
                ...current,
                assessments: [
                  ...current.assessments,
                  { id, scorerHash, ratings: { ...ratings } },
                ],
              }
            : current,
        );
        assessmentId.current = null;
        setMessage("Assessment saved as an immutable review.");
      }
    } catch {
      if (mounted.current)
        setError(
          "Assessment was not confirmed. Retry keeps the same review ID.",
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const trace = detail?.trace;
  const duration =
    trace && typeof trace.startedAt === "number" && typeof trace.endedAt === "number"
      ? Math.max(0, trace.endedAt - trace.startedAt)
      : null;
  return (
    <section
      className={`surface-card ${styles.card}`}
      aria-label="Trace review"
    >
      <div className={styles.cardHead}>
        <div className="min-w-0">
          <h2 className={`${styles.heading} ${styles.headingRow}`}>
            Trace review
            {trace ? (
              <span
                className={styles.pill}
                data-tone={trace.status === "ok" ? "success" : "danger"}
              >
                <span className={styles.pillDot} aria-hidden="true" />
                {trace.status}
              </span>
            ) : null}
          </h2>
          <code className={styles.reviewId}>{traceId}</code>
        </div>
        <button type="button" className="app-button secondary" onClick={onClose}>
          Close review
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.inlineError}>
          {error}
        </p>
      )}
      {message && (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      )}
      {!detail || !trace ? (
        !error && <LoadingState rows={3} />
      ) : (
        <div className={styles.detail}>
          <dl className={styles.traceFacts} aria-label="Trace facts">
            <div>
              <dt>Status</dt>
              <dd>{trace.status}</dd>
            </div>
            <div>
              <dt>Grade</dt>
              <dd>{gradeLabel(detail.grades?.[0])}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>
                {typeof trace.startedAt === "number"
                  ? formatTimestamp(trace.startedAt)
                  : "Unknown"}
              </dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd className="mono">
                {duration === null ? "Unknown" : formatDuration(duration)}
              </dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{trace.source ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Omitted steps</dt>
              <dd className="mono">{trace.droppedSteps ?? 0}</dd>
            </div>
            <div>
              <dt>Experiment</dt>
              <dd className="mono" title={trace.experimentId}>
                {shortId(trace.experimentId)}
              </dd>
            </div>
            <div>
              <dt>Policy</dt>
              <dd className="mono" title={trace.policyVersion}>
                {shortId(trace.policyVersion)}
              </dd>
            </div>
          </dl>
          <div className={styles.reviewGrid}>
            <div>
              <h3 className={styles.subheading}>Checks</h3>
              {orderedChecks(trace.checks as Record<string, boolean | null>)
                .length === 0 ? (
                <p className={styles.note}>None declared.</p>
              ) : (
                <span className={styles.checkList}>
                  {orderedChecks(
                    trace.checks as Record<string, boolean | null>,
                  ).map((check) => (
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
                    >
                      {check.value === null ? "?" : check.value ? "✓" : "✕"}{" "}
                      {check.name}
                    </span>
                  ))}
                </span>
              )}
            </div>
            <div>
              <h3 className={styles.subheading}>Metrics</h3>
              {Object.keys(trace.metrics ?? {}).length === 0 ? (
                <p className={styles.note}>None recorded.</p>
              ) : (
                <dl className={styles.metricList}>
                  {Object.entries(
                    (trace.metrics ?? {}) as Record<string, number | null>,
                  ).map(([name, value]) => (
                    <div key={name}>
                      <dt>{name}</dt>
                      <dd className="mono">{formatMetric(name, value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
          {trace.coverage && Object.keys(trace.coverage).length > 0 ? (
            <details>
              <summary>Coverage</summary>
              <pre>{JSON.stringify(trace.coverage, null, 2)}</pre>
            </details>
          ) : null}
          {detail.grades?.length ? (
            <details open>
              <summary>Grade history ({detail.grades.length})</summary>
              <ol>
                {detail.grades.map(grade => (
                  <li key={grade.id}>
                    <strong>{gradeLabel(grade)}</strong> · {grade.source} · v{grade.version}
                    {" · "}{formatTimestamp(grade.occurredAt)}
                    {contentLoaded && detail.content["grade-" + grade.id] != null && (
                      <pre>{JSON.stringify(detail.content["grade-" + grade.id], null, 2)}</pre>
                    )}
                  </li>
                ))}
              </ol>
              {detail.nextGrade && (
                <button type="button" className="app-button secondary" disabled={busy}
                  onClick={() => void loadOlderGrades()}>Load older grades</button>
              )}
            </details>
          ) : null}
          <details open>
            <summary>Agent steps ({trace.steps?.length ?? 0})</summary>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Step</th>
                    <th>Kind</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Attributes</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.steps?.map((step) => (
                    <tr key={step.id}>
                      <td>{step.name}</td>
                      <td>{step.kind}</td>
                      <td>
                        <span
                          className={styles.pill}
                          data-tone={step.status === "ok" ? "success" : "danger"}
                        >
                          <span className={styles.pillDot} aria-hidden="true" />
                          {step.status}
                        </span>
                      </td>
                      <td className="mono">
                        {step.durationMs == null
                          ? "Unknown"
                          : formatDuration(step.durationMs)}
                      </td>
                      <td>
                        {Object.keys(step.attributes ?? {}).length === 0 ? (
                          <span className={styles.faint}>—</span>
                        ) : (
                          <code>{JSON.stringify(step.attributes)}</code>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <details open>
            <summary>Outcome events ({detail.outcomes.length})</summary>
            {detail.outcomes.length === 0 ? (
              <p className={styles.note}>No outcomes yet.</p>
            ) : (
              <ul className={styles.outcomes}>
                {detail.outcomes
                  .slice()
                  .sort((a, b) => a.occurredAt - b.occurredAt)
                  .map((event) => (
                    <li key={event.id}>
                      <strong>{event.name}</strong>
                      <span className={styles.faint}>
                        {formatTimestamp(event.occurredAt)}
                      </span>
                      <code>{JSON.stringify(event.attributes)}</code>
                    </li>
                  ))}
              </ul>
            )}
          </details>
          {admin && (
            <>
              <div className={styles.headingRow}>
                <button
                  type="button"
                  className="app-button secondary"
                  disabled={busy}
                  onClick={() => void loadContent()}
                >
                  {contentLoaded
                    ? "Refresh diagnostic content"
                    : "Load diagnostic content"}
                </button>
                <InfoTip label="Diagnostic content details" align="start">
                  Redacted content can still contain sensitive personal
                  information.
                </InfoTip>
              </div>
              {contentLoaded &&
                (Object.keys(detail.content).length ? (
                  <pre>{JSON.stringify(detail.content, null, 2)}</pre>
                ) : (
                  <p className={styles.note}>
                    No diagnostic content is stored for this trace.
                  </p>
                ))}
              <form
                className={styles.assessment}
                onSubmit={(event) => {
                  event.preventDefault();
                  void assess();
                }}
              >
                <h3 className={`${styles.subheading} ${styles.headingRow}`}>
                  Human quality assessment
                  <InfoTip label="Assessment details" align="start">
                    Rubric version 1. Each save adds a review.
                  </InfoTip>
                </h3>
                <fieldset disabled={busy} className={styles.ratingGrid}>
                  {criteria.map((name) => (
                    <div className="field" key={name}>
                      <span className={styles.headingRow}>
                        <label htmlFor={`rating-${name}`}>
                          {name.replaceAll("_", " ")}
                        </label>
                        <InfoTip label={`${name.replaceAll("_", " ")} criterion`} align="start">
                          {reviewRubric[name]}
                        </InfoTip>
                      </span>
                      <Select
                        id={`rating-${name}`}
                        value={ratings[name]}
                        onChange={(event) => {
                          assessmentId.current = null;
                          setRatings({
                            ...ratings,
                            [name]: event.target.value as
                              | "pass"
                              | "fail"
                              | "unknown",
                          });
                        }}
                      >
                        <option value="unknown">Unknown</option>
                        <option value="pass">Pass</option>
                        <option value="fail">Fail</option>
                      </Select>
                    </div>
                  ))}
                </fieldset>
                <button className="app-button" disabled={busy}>
                  Save assessment
                </button>
              </form>
            </>
          )}
          <details>
            <summary>Saved assessments ({detail.assessments.length})</summary>
            {detail.assessments.length === 0 ? (
              <p className={styles.note}>None yet.</p>
            ) : (
              <ul className={styles.outcomes}>
                {detail.assessments.map((item) => (
                  <li key={item.id}>
                    <code title={item.scorerHash}>{shortId(item.id)}</code>
                    <span className={styles.checkList}>
                      {Object.entries(item.ratings).map(([name, value]) => (
                        <span
                          key={name}
                          className={styles.check}
                          data-result={value}
                        >
                          {name.replaceAll("_", " ")}: {value}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </div>
      )}
    </section>
  );
}
