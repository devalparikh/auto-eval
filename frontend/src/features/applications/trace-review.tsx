"use client";
import { useEffect, useRef, useState } from "react";
import { Select } from "@/components/select";
import { LoadingState } from "@/components/states";
import { apiRequest } from "@/lib/api";
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
  return (
    <section
      className={`surface-card ${styles.card}`}
      aria-label="Trace review"
    >
      <div className={styles.picker}>
        <h2 className={styles.heading}>Trace review</h2>
        <button className="app-button secondary" onClick={onClose}>
          Close review
        </button>
      </div>
      <code>{traceId}</code>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!detail ? (
        !error && <LoadingState rows={3} />
      ) : (
        <div className={styles.detail}>
          <p className={styles.note}>
            Policy {detail.trace.policyVersion} · Experiment{" "}
            {detail.trace.experimentId}
          </p>
          <p className={styles.note}>
            Status: {detail.trace.status}. Omitted steps:{" "}
            {detail.trace.droppedSteps ?? 0}. Unknown measurements remain
            unknown.
          </p>
          <details>
            <summary>Measurements and coverage</summary>
            <pre>
              {JSON.stringify(
                {
                  metrics: detail.trace.metrics,
                  checks: detail.trace.checks,
                  coverage: detail.trace.coverage,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <details open>
            <summary>Agent steps ({detail.trace.steps?.length ?? 0})</summary>
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
                  {detail.trace.steps?.map((step) => (
                    <tr key={step.id}>
                      <td>{step.name}</td>
                      <td>{step.kind}</td>
                      <td>{step.status}</td>
                      <td>
                        {step.durationMs === null
                          ? "Unknown"
                          : `${step.durationMs} ms`}
                      </td>
                      <td>
                        <code>{JSON.stringify(step.attributes)}</code>
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
              <p className={styles.note}>
                No outcome recorded. Pending does not mean rejected or ignored.
              </p>
            ) : (
              detail.outcomes
                .slice()
                .sort((a, b) => a.occurredAt - b.occurredAt)
                .map((event) => (
                  <p key={event.id}>
                    <strong>{event.name}</strong> ·{" "}
                    {new Date(event.occurredAt).toLocaleString()} ·{" "}
                    <code>{JSON.stringify(event.attributes)}</code>
                  </p>
                ))
            )}
          </details>
          {admin && (
            <>
              <div>
                <button
                  className="app-button secondary"
                  disabled={busy}
                  onClick={() => void loadContent()}
                >
                  {contentLoaded
                    ? "Refresh diagnostic content"
                    : "Load diagnostic content"}
                </button>
                <p className={styles.note}>
                  Redacted conversation and selected evidence may still contain
                  sensitive health information.
                </p>
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
                onSubmit={(event) => {
                  event.preventDefault();
                  void assess();
                }}
              >
                <h3 className={styles.heading}>Human quality assessment</h3>
                <p className={styles.note}>
                  Rubric version 1. Each save appends a review; acceptance of a
                  proposal alone does not prove quality.
                </p>
                <fieldset disabled={busy} className={styles.fieldset}>
                  {criteria.map((name) => (
                    <div className="field" key={name}>
                      <label htmlFor={`rating-${name}`}>
                        {name.replaceAll("_", " ")}
                      </label>
                      <p className={styles.note}>{reviewRubric[name]}</p>
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
                  <button className="app-button">Save assessment</button>
                </fieldset>
              </form>
            </>
          )}
          <details>
            <summary>Saved assessments ({detail.assessments.length})</summary>
            <pre>{JSON.stringify(detail.assessments, null, 2)}</pre>
          </details>
        </div>
      )}
    </section>
  );
}
