"use client";

import { ArrowClockwiseIcon, GearSixIcon, PlusIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TraceReview } from "./trace-review";
import { ApplicationKeys } from "./application-keys";
import { KeyLifespan, lifespanExpiry, type Lifespan } from "./key-lifespan";
import { ObservationTable } from "./observation-table";
import {
  applicationStage,
  formatAgo,
  formatTimestamp,
  initialApplication,
  summarizeFeed,
  type ApplicationStage,
  type FeedObservation,
} from "./observation-feed";
import { InfoTip } from "@/components/info-tip";
import { PageHeader } from "@/components/page-header";
import { Select } from "@/components/select";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { API_URL, apiRequest } from "@/lib/api";
import { countOf } from "@/lib/format";
import styles from "./applications.module.css";

import type { Application, AppKey as Key } from "./application-types";

type Experiment = {
  id: string;
  models: { model: string }[];
  mode: string;
  datasetHash: string | null;
};
type Comparison = {
  mode: string;
  cases: {
    id: string;
    beforeStatus: string;
    afterStatus: string;
    values: {
      semanticId: string;
      compatible: boolean;
      beforeResult: string;
      afterResult: string;
      before: number | boolean | null;
      after: number | boolean | null;
    }[];
  }[];
};

/** How often an application with no traces yet checks for its first one. */
const WAITING_POLL_MS = 10_000;
const UNCERTAIN_WRITE =
  "Not confirmed. Refresh before trying again; a key may have been created.";
/**
 * Statuses where the server answered and refused before writing anything. A
 * conflict (409) or a lost response stays uncertain: the write may exist.
 */
const DEFINITE_REJECTIONS = new Set([400, 401, 403, 404, 422, 429]);

/** Keep the open application in the URL so a reload or a shared link keeps it. */
function persistApplication(id: string) {
  try {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("app", id);
    else url.searchParams.delete("app");
    window.history.replaceState(null, "", url);
  } catch {
    // Not fatal: the selection still works for this visit.
  }
}

export function ApplicationsScreen() {
  const [ingestEndpoint, setIngestEndpoint] = useState("");
  const [apps, setApps] = useState<Application[]>([]);
  const [selected, setSelected] = useState("");
  const selectedRef = useRef("");
  const [traces, setTraces] = useState<FeedObservation[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [detailLoaded, setDetailLoaded] = useState("");
  const [keys, setKeys] = useState<Key[]>([]);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const createId = useRef<string | null>(null);
  const mutationEpoch = useRef(0);
  const [error, setError] = useState("");
  const [errorTitle, setErrorTitle] = useState("");
  function fail(title: string, message: string) {
    setErrorTitle(title);
    setError(message);
  }
  // A read that reconciles an uncertain write also retires its warning.
  function reconciled() {
    setUncertain(false);
    setError((current) => (current === UNCERTAIN_WRITE ? "" : current));
  }
  const [notice, setNotice] = useState("");
  const [secret, setSecret] = useState("");
  const [revision, setRevision] = useState(0);
  const [name, setName] = useState("");
  const [lifespan, setLifespan] = useState<Lifespan>("30");
  const [customDays, setCustomDays] = useState("180");
  const [overlap, setOverlap] = useState("1");
  const [clock, setClock] = useState(0);
  // Validity only; each request computes its own expiry when it is sent.
  const validLifetime = lifespanExpiry(lifespan, customDays, 0) !== undefined;
  const expiresAt = () => lifespanExpiry(lifespan, customDays, Date.now()) ?? null;
  const [reviewTrace, setReviewTrace] = useState("");
  const reviewRef = useRef<HTMLDivElement>(null);
  const pending = useRef(false),
    mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [registerOpen, setRegisterOpen] = useState(false);

  function choose(id: string) {
    // Re-choosing the open application keeps its data; clearing it here would
    // leave the screen empty because the load effect does not run again.
    if (id === selectedRef.current) return;
    setSelected(id);
    selectedRef.current = id;
    setReviewTrace("");
    setTraces([]);
    setKeys([]);
    setExperiments([]);
    setSecret("");
    setNotice("");
    setLeft("");
    setRight("");
    setComparison(null);
    persistApplication(id);
  }

  function refresh() {
    setError("");
    setComparison(null);
    setReviewTrace("");
    setRevision((value) => value + 1);
  }

  useEffect(() => {
    const controller = new AbortController();
    const readEpoch = mutationEpoch.current;
    const canReconcile = !pending.current;
    Promise.all([
      apiRequest<Application[]>("/applications", { signal: controller.signal }),
      apiRequest<{ role: string }>("/auth/session", {
        signal: controller.signal,
      }),
    ])
      .then(([items, user]) => {
        if (!controller.signal.aborted && readEpoch === mutationEpoch.current) {
          setIngestEndpoint(
            new URL(
              API_URL.replace(/\/api$/, "") + "/v2/traces",
              window.location.origin,
            ).href,
          );
          setApps(items);
          const recovered = items.find((item) => item.id === createId.current);
          if (recovered) {
            setSelected(recovered.id);
            selectedRef.current = recovered.id;
            persistApplication(recovered.id);
            createId.current = null;
            setRegisterOpen(false);
            setName("");
            setNotice(
              "Application created. Its first key can’t be shown again; issue a new one.",
            );
          } else if (!selectedRef.current) {
            // Open the application the URL names, or the only one there is,
            // so a single connected app never lands on a chooser. Nothing is
            // kept in browser storage.
            const opened = initialApplication(
              items.map((item) => item.id),
              new URLSearchParams(window.location.search).get("app"),
            );
            if (opened) {
              setSelected(opened);
              selectedRef.current = opened;
            }
          }
          if (canReconcile && !selectedRef.current) reconciled();
          setAdmin(user.role === "admin");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && readEpoch === mutationEpoch.current)
          fail(
            "Couldn’t load applications",
            "Applications could not be loaded. Refresh to try again.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    const readEpoch = mutationEpoch.current;
    const canReconcile = !pending.current;
    Promise.all([
      apiRequest<FeedObservation[]>(`/applications/${selected}/traces`, {
        signal: controller.signal,
      }),
      admin
        ? apiRequest<Key[]>(`/applications/${selected}/keys`, {
            signal: controller.signal,
          })
        : Promise.resolve([]),
      (async () => {
        const all: Experiment[] = [];
        let after = "";
        for (;;) {
          const page = await apiRequest<Experiment[]>(
            `/applications/${selected}/experiments?evaluations_only=true${after ? "&after=" + after : ""}`,
            { signal: controller.signal },
          );
          all.push(...page);
          if (page.length < 100) return all;
          const next = page[page.length - 1].id;
          if (next <= after || all.length > 10000)
            throw new Error("Invalid experiment page");
          after = next;
        }
      })(),
    ])
      .then(([items, issued, runs]) => {
        if (!controller.signal.aborted && readEpoch === mutationEpoch.current) {
          setTraces(items);
          setKeys(issued);
          setClock(Date.now());
          setExperiments(runs);
          setDetailLoaded(selected);
          if (canReconcile) reconciled();
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && readEpoch === mutationEpoch.current)
          fail(
            "Couldn’t load this application",
            "Application data could not be loaded. Refresh to try again.",
          );
      });
    return () => controller.abort();
  }, [selected, admin, revision]);

  // Until the first trace lands, check for it quietly. Only the trace list is
  // read, only while the tab is visible, and never across a pending write.
  const waitingForFirst =
    Boolean(selected) && detailLoaded === selected && traces.length === 0;
  useEffect(() => {
    if (!waitingForFirst || uncertain) return;
    const controller = new AbortController();
    const app = selected;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || pending.current) return;
      const readEpoch = mutationEpoch.current;
      apiRequest<FeedObservation[]>(`/applications/${app}/traces`, {
        signal: controller.signal,
      })
        .then((items) => {
          if (
            !controller.signal.aborted &&
            readEpoch === mutationEpoch.current &&
            selectedRef.current === app &&
            items.length > 0
          ) {
            setTraces(items);
            setClock(Date.now());
          }
        })
        .catch(() => {
          // A missed poll is retried on the next tick; Refresh reports errors.
        });
    }, WAITING_POLL_MS);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [waitingForFirst, uncertain, selected]);

  // The review opens below the list; bring it to the reader instead of
  // leaving it under the fold.
  useEffect(() => {
    if (!reviewTrace) return;
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    reviewRef.current?.scrollIntoView?.({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
  }, [reviewTrace]);

  async function mutate(path: string, body?: unknown) {
    if (pending.current || uncertain) return;
    pending.current = true;
    mutationEpoch.current++;
    setBusy(true);
    setError("");
    setNotice("");
    setSecret("");
    try {
      const result = await apiRequest<{
        id?: string;
        token?: string;
        key?: { token: string };
      }>(path, {
        method: "POST",
        body,
      });
      if (!mounted.current) return;
      if (result.token) setSecret(result.token);
      if (result.key) {
        setSecret(result.key.token);
        setSelected(result.id!);
        selectedRef.current = result.id!;
        persistApplication(result.id!);
        createId.current = null;
        // Registered: the key panel takes over, so the form closes.
        setRegisterOpen(false);
        setName("");
      }
      setRevision((value) => value + 1);
    } catch (caught) {
      if (!mounted.current) return;
      const status = (caught as { status?: unknown } | null)?.status;
      if (typeof status === "number" && DEFINITE_REJECTIONS.has(status)) {
        // The server refused it outright, so there is nothing to reconcile.
        createId.current = null;
        fail(
          "Rejected",
          `The server refused this request (HTTP ${status}). Nothing was saved.`,
        );
      } else {
        setUncertain(true);
        fail("Not confirmed", UNCERTAIN_WRITE);
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const comparable = experiments.filter((run) => run.mode !== "observed");
  const current = apps.find((app) => app.id === selected);
  // Registering is its own task: the open application's cards (and their key
  // controls, which share the lifespan choice) step aside until it finishes.
  const loaded =
    Boolean(selected) && detailLoaded === selected && !registerOpen;
  const stage = applicationStage({ traces, keys, now: clock });
  const summary = summarizeFeed(traces);

  const connection = admin && current && (
    <ApplicationKeys
      appName={current.name}
      endpoint={ingestEndpoint}
      keys={keys}
      clock={clock}
      leading={stage !== "receiving"}
      busy={busy}
      locked={uncertain}
      validLifetime={validLifetime}
      lifespan={lifespan}
      customDays={customDays}
      onLifespan={setLifespan}
      onCustomDays={setCustomDays}
      overlap={overlap}
      onOverlap={setOverlap}
      secret={secret}
      onHideSecret={() => setSecret("")}
      onIssue={() =>
        void mutate(`/applications/${selected}/keys`, {
          expiresAt: expiresAt(),
        })
      }
      onRotate={(key) =>
        void mutate(`/applications/${selected}/keys/${key.id}/rotate`, {
          expiresAt: expiresAt(),
          retireAt: Number(overlap)
            ? Math.min(
                Date.now() + Number(overlap) * 3600000,
                key.expiresAt ?? Infinity,
                key.retireAt ?? Infinity,
              )
            : null,
        })
      }
      onRevoke={(key) =>
        void mutate(`/applications/${selected}/keys/${key.id}/revoke`)
      }
    />
  );

  const compareCard = (
    <section
      className={`surface-card ${styles.card}`}
      aria-labelledby="compare-heading"
    >
      <h2
        id="compare-heading"
        className={`${styles.heading} ${styles.headingRow}`}
      >
        Compare experiments
        <InfoTip label="Comparison requirements" align="start">
          Both experiments need complete case sets from the same finalized
          dataset and mode.
        </InfoTip>
      </h2>
      {comparable.length < 2 ? (
        <p className={styles.note}>
          <span className="mono">{comparable.length} of 2</span> experiments.
          Production traces are observations, not experiments: run the
          application benchmark in scripted or live mode to add one.
        </p>
      ) : (
        <>
          <div className={styles.row}>
            <div className="field">
              <label htmlFor="compare-baseline">Baseline</label>
              <Select
                id="compare-baseline"
                disabled={busy}
                value={left}
                onChange={(event) => {
                  setLeft(event.target.value);
                  setComparison(null);
                }}
              >
                <option value="">Select experiment</option>
                {comparable.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.models.map((model) => model.model).join(", ")} /{" "}
                    {run.id}
                  </option>
                ))}
              </Select>
            </div>
            <div className="field">
              <label htmlFor="compare-candidate">Candidate</label>
              <Select
                id="compare-candidate"
                disabled={busy}
                value={right}
                onChange={(event) => {
                  setRight(event.target.value);
                  setComparison(null);
                }}
              >
                <option value="">Select experiment</option>
                {comparable.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.models.map((model) => model.model).join(", ")} /{" "}
                    {run.id}
                  </option>
                ))}
              </Select>
            </div>
            <button
              type="button"
              className="app-button"
              disabled={busy || !left || !right || left === right}
              onClick={async () => {
                setBusy(true);
                setError("");
                setComparison(null);
                try {
                  setComparison(
                    await apiRequest<Comparison>(
                      `/applications/${selected}/comparisons/${left}/${right}`,
                    ),
                  );
                } catch {
                  fail(
                    "Comparison unavailable",
                    "Comparison unavailable for these experiments.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Compare
            </button>
          </div>
          {comparison && (
            <div className={styles.comparison}>
              <p className="mono">Mode: {comparison.mode}</p>
              {comparison.cases.map((item) => (
                <div key={item.id} className={styles.case}>
                  <code>{item.id}</code>
                  <p>
                    {item.beforeStatus} → {item.afterStatus}
                  </p>
                  {item.values.map((check) => (
                    <p key={check.semanticId} className="mono">
                      {check.semanticId}
                      {check.compatible ? "" : " (not comparable)"}:{" "}
                      {check.before === null ? "Unknown" : String(check.before)}{" "}
                      ({check.beforeResult}) →{" "}
                      {check.after === null ? "Unknown" : String(check.after)} (
                      {check.afterResult})
                    </p>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );

  return (
    <div className={styles.screen}>
      <PageHeader
        title="Applications"
        action={
          <div className="flex gap-2">
            <button
              type="button"
              className="app-button secondary"
              disabled={busy}
              onClick={refresh}
            >
              <ArrowClockwiseIcon size={13} aria-hidden="true" />
              Refresh
            </button>
            {admin && apps.length > 0 && !registerOpen && (
              <button
                type="button"
                className="app-button"
                disabled={busy}
                onClick={() => setRegisterOpen(true)}
              >
                <PlusIcon size={13} aria-hidden="true" />
                Register application
              </button>
            )}
          </div>
        }
      />
      <div className={styles.body}>
        {error && (
          <div role="alert">
            <ErrorState
              className=""
              title={errorTitle || "Couldn’t finish that"}
              message={error}
              retry={busy ? undefined : refresh}
            />
          </div>
        )}
        {notice && (
          <p role="status" className={styles.notice}>
            {notice}
          </p>
        )}
        {loading ? (
          <LoadingState rows={2} />
        ) : apps.length === 0 ? (
          !registerOpen &&
          (admin ? (
            <FirstApplication onRegister={() => setRegisterOpen(true)} />
          ) : (
            <section className={`surface-card ${styles.card}`}>
              <EmptyState
                title="No applications shared with you"
                message="Ask your operator for access."
              />
            </section>
          ))
        ) : (
          <section
            className={`surface-card ${styles.card} ${styles.appHeader}`}
          >
            <div className={styles.picker}>
              <div className="field">
                <label htmlFor="application-select">Application</label>
                <Select
                  id="application-select"
                  disabled={busy}
                  value={selected}
                  onChange={(event) => choose(event.target.value)}
                >
                  <option value="">Select an application</option>
                  {apps.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.name}
                    </option>
                  ))}
                </Select>
              </div>
              {current ? (
                <dl className={styles.facts}>
                  <div>
                    <dt>Last trace</dt>
                    <dd>
                      {detailLoaded !== selected ? (
                        <span className={styles.faint}>…</span>
                      ) : summary.lastSeen !== null ? (
                        <time
                          dateTime={new Date(summary.lastSeen).toISOString()}
                          title={formatTimestamp(summary.lastSeen)}
                        >
                          {formatAgo(summary.lastSeen, clock)}
                        </time>
                      ) : (
                        "None yet"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Retention</dt>
                    <dd className="mono">
                      {current.settings.retention_days === null
                        ? "Keep"
                        : `${current.settings.retention_days}d`}
                    </dd>
                  </div>
                  {admin && (
                    <Link
                      className="app-button secondary"
                      href={`/applications/${selected}/settings`}
                    >
                      <GearSixIcon size={13} aria-hidden="true" />
                      App settings
                    </Link>
                  )}
                </dl>
              ) : null}
            </div>
            {current && loaded ? (
              <Readiness
                stage={stage}
                admin={admin}
                traceCount={summary.total}
                experimentCount={comparable.length}
              />
            ) : null}
          </section>
        )}
        {/* Opened from the header or the empty state; it closes once the
            application exists and its key is on screen. */}
        {admin && registerOpen && (
          <section
            className={`surface-card ${styles.card}`}
            aria-labelledby="register-heading"
          >
            <h2 id="register-heading" className={styles.heading}>
              Register application
            </h2>
            <form
              className={styles.registerForm}
              onSubmit={(event) => {
                event.preventDefault();
                createId.current ??= crypto.randomUUID();
                void mutate("/applications", {
                  id: createId.current,
                  name,
                  key: { expiresAt: expiresAt() },
                });
              }}
            >
              <div className="field">
                <label htmlFor="application-name">Name</label>
                <input
                  id="application-name"
                  className="app-input"
                  required
                  maxLength={96}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <KeyLifespan
                id="application-lifespan"
                lifespan={lifespan}
                customDays={customDays}
                onLifespan={setLifespan}
                onCustomDays={setCustomDays}
              />
              <div className="flex gap-2">
                <button
                  className="app-button"
                  disabled={busy || uncertain || !validLifetime}
                >
                  Register
                </button>
                <button
                  type="button"
                  className="app-button secondary"
                  disabled={busy}
                  onClick={() => setRegisterOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        )}
        {apps.length > 0 && !selected && !loading && !registerOpen ? (
          <section
            className={`surface-card ${styles.card}`}
            aria-labelledby="choose-heading"
          >
            <h2 id="choose-heading" className={styles.heading}>
              Choose an application
            </h2>
            <ul className={styles.appList}>
              {apps.map((app) => (
                <li key={app.id}>
                  <button
                    type="button"
                    className={styles.appChoice}
                    onClick={() => choose(app.id)}
                  >
                    <span>{app.name}</span>
                    <code>{app.id.slice(0, 8)}</code>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {selected && !registerOpen && detailLoaded !== selected ? (
          <section className={`surface-card ${styles.card}`}>
            <LoadingState rows={3} />
          </section>
        ) : null}
        {loaded && stage !== "receiving" ? (
          <>
            {connection}
            <section
              className={`surface-card ${styles.card}`}
              aria-labelledby="traces-heading"
            >
              <TracesHeading summary={null} />
              <EmptyState
                title="Waiting for the first trace"
                message={
                  admin
                    ? stage === "connect"
                      ? "Issue a key, set the settings above on the app’s server, then send one request. This list checks every 10 seconds."
                      : "Deploy the settings above and send one request. This list checks every 10 seconds."
                    : "Traces appear once the application is connected. This list checks every 10 seconds."
                }
              />
            </section>
            {compareCard}
          </>
        ) : null}
        {loaded && stage === "receiving" ? (
          <>
            <section
              className={`surface-card ${styles.card}`}
              aria-labelledby="traces-heading"
            >
              <TracesHeading summary={summary} />
              <ObservationTable
                traces={traces}
                selectedId={reviewTrace}
                now={clock}
                onOpen={(id) =>
                  setReviewTrace((open) => (open === id ? "" : id))
                }
              />
            </section>
            {reviewTrace && (
              <div ref={reviewRef} className={styles.reviewAnchor}>
                <TraceReview
                  key={`${selected}:${reviewTrace}`}
                  appId={selected}
                  traceId={reviewTrace}
                  admin={admin}
                  onClose={() => setReviewTrace("")}
                />
              </div>
            )}
            {compareCard}
            {connection}
          </>
        ) : null}
      </div>
    </div>
  );
}

function TracesHeading({
  summary,
}: {
  summary: ReturnType<typeof summarizeFeed> | null;
}) {
  return (
    <div className={styles.cardHead}>
      <h2
        id="traces-heading"
        className={`${styles.heading} ${styles.headingRow}`}
      >
        Recent traces
        <InfoTip label="Observation details" align="start">
          The latest 100 unexpired observations sent by this application.
        </InfoTip>
      </h2>
      {summary ? (
        <p className={`mono ${styles.tally}`}>
          <span>{countOf(summary.total, "trace")}</span>
          <span data-tone={summary.errors ? "danger" : undefined}>
            {countOf(summary.errors, "error")}
          </span>
          <span data-tone={summary.failedChecks ? "danger" : undefined}>
            {summary.failedChecks} with failed checks
          </span>
        </p>
      ) : null}
    </div>
  );
}

const STAGE_ORDER: ApplicationStage[] = ["connect", "waiting", "receiving"];

/**
 * Where this application is in the loop: connected, receiving, comparable.
 * The current step carries the accent; finished ones are green, the rest wait.
 */
function Readiness({
  stage,
  admin,
  traceCount,
  experimentCount,
}: {
  stage: ApplicationStage;
  admin: boolean;
  traceCount: number;
  experimentCount: number;
}) {
  const index = STAGE_ORDER.indexOf(stage);
  const comparable = experimentCount >= 2;
  const steps = [
    {
      label: "Connect",
      detail:
        index > 0 ? "Key issued" : admin ? "Issue a key" : "Not connected",
      state: index > 0 ? "done" : "current",
    },
    {
      label: "Receive traces",
      detail:
        traceCount > 0
          ? countOf(traceCount, "recent trace")
          : "Waiting for the first",
      state: index > 1 ? "done" : index === 1 ? "current" : "pending",
    },
    {
      label: "Compare experiments",
      detail: comparable
        ? `${experimentCount} experiments`
        : `${experimentCount} of 2 experiments`,
      state: comparable ? "done" : index === 2 ? "current" : "pending",
    },
  ] as const;
  return (
    <ol className={styles.readiness} aria-label="Application readiness">
      {steps.map((step, position) => (
        <li
          key={step.label}
          data-state={step.state}
          aria-current={step.state === "current" ? "step" : undefined}
        >
          <span className={styles.readinessMark} aria-hidden="true">
            {step.state === "done" ? "✓" : position + 1}
          </span>
          <span>
            <span className={styles.readinessLabel}>{step.label}</span>
            <span className={styles.readinessDetail}>{step.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The workspace has no applications: say what connecting one involves. */
function FirstApplication({ onRegister }: { onRegister: () => void }) {
  return (
    <section
      className={`surface-card ${styles.card} ${styles.onboarding}`}
      aria-labelledby="first-application-heading"
    >
      <p className={styles.eyebrow}>Get started</p>
      <h2 id="first-application-heading" className={styles.onboardingTitle}>
        Connect your first application
      </h2>
      <ol className={styles.onboardingSteps}>
        <li>
          <span className="mono">01</span>
          <span>
            <strong>Register it.</strong> Name the app and receive its key,
            shown once.
          </span>
        </li>
        <li>
          <span className="mono">02</span>
          <span>
            <strong>Set the SDK settings</strong> on the app’s server and
            deploy.
          </span>
        </li>
        <li>
          <span className="mono">03</span>
          <span>
            <strong>Send one request.</strong> Its trace appears here within
            seconds.
          </span>
        </li>
      </ol>
      <button type="button" className="app-button" onClick={onRegister}>
        <PlusIcon size={13} aria-hidden="true" />
        Register application
      </button>
    </section>
  );
}
