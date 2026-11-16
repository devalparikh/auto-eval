"use client";

import { ArrowClockwiseIcon, CheckIcon, CopyIcon, PlusIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TraceReview } from "./trace-review";
import { KeyLifespan, lifespanExpiry, type Lifespan } from "./key-lifespan";
import { InfoTip } from "@/components/info-tip";
import { PageHeader } from "@/components/page-header";
import { Select } from "@/components/select";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { API_URL, apiRequest } from "@/lib/api";
import styles from "./applications.module.css";

import type { Application, AppKey as Key } from "./application-types";
type Observation = {
  id: string;
  experimentId: string;
  source: string;
  status: string;
  metrics: Record<string, number | null>;
  checks: Record<string, boolean | null>;
};
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

export function ApplicationsScreen() {
  const [ingestEndpoint, setIngestEndpoint] = useState("");
  const [apps, setApps] = useState<Application[]>([]);
  const [selected, setSelected] = useState("");
  const selectedRef = useRef("");
  const [traces, setTraces] = useState<Observation[]>([]);
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
  const [secret, setSecret] = useState("");
  const [revision, setRevision] = useState(0);
  const [name, setName] = useState("");
  const [lifespan, setLifespan] = useState<Lifespan>("30");
  const [customDays, setCustomDays] = useState("180");
  const [overlap, setOverlap] = useState("1");
  const [clock, setClock] = useState(0);
  const [copied, setCopied] = useState(false);
  // Validity only; each request computes its own expiry when it is sent.
  const validLifetime = lifespanExpiry(lifespan, customDays, 0) !== undefined;
  const expiresAt = () => lifespanExpiry(lifespan, customDays, Date.now()) ?? null;
  const [reviewTrace, setReviewTrace] = useState("");
  const pending = useRef(false),
    mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [registerOpen, setRegisterOpen] = useState(false);
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
            createId.current = null;
            setRegisterOpen(false);
            setName("");
            setError(
              "Application created. Its first key can’t be shown again; issue a new one.",
            );
          }
          if (canReconcile && !selectedRef.current) setUncertain(false);
          setAdmin(user.role === "admin");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && readEpoch === mutationEpoch.current)
          setError("Applications could not be loaded. Refresh to try again.");
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
      apiRequest<Observation[]>(`/applications/${selected}/traces`, {
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
          if (canReconcile) setUncertain(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && readEpoch === mutationEpoch.current)
          setError(
            "Application data could not be loaded. Refresh to try again.",
          );
      });
    return () => controller.abort();
  }, [selected, admin, revision]);
  async function mutate(path: string, body?: unknown) {
    if (pending.current || uncertain) return;
    pending.current = true;
    mutationEpoch.current++;
    setBusy(true);
    setError("");
    setSecret("");
    setCopied(false);
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
        createId.current = null;
        // Registered: the key panel takes over, so the form closes.
        setRegisterOpen(false);
        setName("");
      }
      setRevision((value) => value + 1);
    } catch {
      if (!mounted.current) return;
      setUncertain(true);
      setError(
        "Not confirmed. Refresh before trying again; a key may have been created.",
      );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  const comparable = experiments.filter((run) => run.mode !== "observed");
  const current = apps.find((app) => app.id === selected);
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
              onClick={() => {
                setError("");
                setComparison(null);
                setReviewTrace("");
                setRevision((value) => value + 1);
              }}
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
              title="Something went wrong"
              message={error}
            />
          </div>
        )}
        {loading ? (
          <LoadingState rows={2} />
        ) : apps.length === 0 ? (
          !registerOpen && (
          <section className={`surface-card ${styles.card}`}>
            <EmptyState
              title={
                admin
                  ? "No applications yet"
                  : "No applications shared with you"
              }
              message={
                admin
                  ? "Register one to issue its key."
                  : "Ask your operator for access."
              }
              action={
                admin ? (
                  <button
                    type="button"
                    className="app-button"
                    onClick={() => setRegisterOpen(true)}
                  >
                    <PlusIcon size={13} aria-hidden="true" />
                    Register application
                  </button>
                ) : undefined
              }
            />
          </section>
          )
        ) : (
          <section className={`surface-card ${styles.card} ${styles.picker}`}>
            <div className="field">
              <label htmlFor="application-select">Application</label>
              <Select
                id="application-select"
                disabled={busy}
                value={selected}
                onChange={(event) => {
                  setSelected(event.target.value);
                  selectedRef.current = event.target.value;
                  setReviewTrace("");
                  setTraces([]);
                  setKeys([]);
                  setSecret("");
                  setLeft("");
                  setRight("");
                  setComparison(null);
                }}
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
                    App settings
                  </Link>
                )}
              </dl>
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
        {apps.length > 0 && !selected && !loading ? (
          <section className={`surface-card ${styles.card}`}>
            <EmptyState title="Choose an application" />
          </section>
        ) : null}
        {selected && (
          <>
            {admin && (
              <section className={`surface-card ${styles.card}`}>
                <h2 className={`${styles.heading} ${styles.headingRow}`}>
                  Application keys
                  <InfoTip label="SDK settings" align="start">
                    The SDK’s <code>createCaptureFromEnv()</code> reads these
                    on the app’s server: <code>AUTOEVAL_ENABLED=true</code>,{" "}
                    <code>AUTOEVAL_ENDPOINT</code> (below),{" "}
                    <code>AUTOEVAL_INGEST_KEY</code> and{" "}
                    <code>AUTOEVAL_SOURCE</code> (<code>production</code> or{" "}
                    <code>synthetic</code>).
                  </InfoTip>
                </h2>
                <div className={styles.endpoint}>
                  <span>Endpoint</span>
                  <code>{ingestEndpoint}</code>
                </div>
                <div className={styles.row}>
                  <KeyLifespan
                    id="key-lifespan"
                    lifespan={lifespan}
                    customDays={customDays}
                    onLifespan={setLifespan}
                    onCustomDays={setCustomDays}
                  />
                </div>
                <div className={styles.row}>
                  <div className="field">
                    <label htmlFor="rotation-overlap">Rotation overlap</label>
                    <Select
                      id="rotation-overlap"
                      value={overlap}
                      onChange={(event) => setOverlap(event.target.value)}
                    >
                      <option value="1">1 hour</option>
                      <option value="24">24 hours</option>
                      <option value="0">Revoke old key immediately</option>
                    </Select>
                  </div>
                  <button
                    type="button"
                    className="app-button"
                    disabled={busy || uncertain || !validLifetime}
                    onClick={() =>
                      void mutate(`/applications/${selected}/keys`, {
                        expiresAt: expiresAt(),
                      })
                    }
                  >
                    Issue key
                  </button>
                </div>
                {secret && (
                  <div role="status" className={styles.secret}>
                    <p className={styles.headingRow}>
                      New key, shown once
                      <InfoTip label="Key storage" align="start">
                        Store it on the app’s server as{" "}
                        <code>AUTOEVAL_INGEST_KEY</code>. Never send it to a
                        browser.
                      </InfoTip>
                    </p>
                    <code>{secret}</code>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="app-button secondary"
                        onClick={() => void copySecret()}
                      >
                        {copied ? (
                          <CheckIcon size={13} aria-hidden="true" />
                        ) : (
                          <CopyIcon size={13} aria-hidden="true" />
                        )}
                        {copied ? "Copied" : "Copy"}
                      </button>
                      <button
                        type="button"
                        className="app-button secondary"
                        onClick={() => setSecret("")}
                      >
                        Hide key
                      </button>
                    </div>
                  </div>
                )}
                {keys.length === 0 ? (
                  <p className={styles.note}>No keys yet.</p>
                ) : (
                  <ul className={styles.keys}>
                    {keys.map((key) => (
                      <li key={key.id}>
                        <code>{key.id}</code>
                        <span>{key.label}</span>
                        <span className={styles.keyState}>
                          {key.revoked
                            ? "Revoked"
                            : key.expiresAt !== null && key.expiresAt <= clock
                              ? "Expired"
                              : key.retireAt && key.retireAt <= clock
                                ? "Retired"
                                : key.expiresAt === null
                                  ? "No expiry"
                                  : `Expires ${new Date(key.expiresAt).toLocaleString()}`}
                          {key.retireAt && key.retireAt > clock
                            ? ` · Retires ${new Date(key.retireAt).toLocaleString()}`
                            : ""}
                        </span>
                        {!key.revoked && (
                          <span className={styles.keyActions}>
                            <button
                              type="button"
                              className="app-button secondary"
                              disabled={
                                busy ||
                                uncertain ||
                                !validLifetime ||
                                (key.expiresAt !== null &&
                                  key.expiresAt <= clock) ||
                                Boolean(key.retireAt && key.retireAt <= clock)
                              }
                              onClick={() =>
                                void mutate(
                                  `/applications/${selected}/keys/${key.id}/rotate`,
                                  {
                                    expiresAt: expiresAt(),
                                    retireAt: Number(overlap)
                                      ? Math.min(
                                          Date.now() +
                                            Number(overlap) * 3600000,
                                          key.expiresAt ?? Infinity,
                                          key.retireAt ?? Infinity,
                                        )
                                      : null,
                                  },
                                )
                              }
                            >
                              Rotate
                            </button>
                            <button
                              type="button"
                              className="app-button secondary"
                              disabled={busy || uncertain}
                              onClick={() =>
                                void mutate(
                                  `/applications/${selected}/keys/${key.id}/revoke`,
                                )
                              }
                            >
                              Revoke
                            </button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            <section className={`surface-card ${styles.card}`}>
              <h2 className={`${styles.heading} ${styles.headingRow}`}>
                Recent observations
                <InfoTip label="Observation details" align="start">
                  The latest 100 unexpired observations. Withdrawn consent
                  removes a user’s observations.
                </InfoTip>
              </h2>
              {detailLoaded !== selected ? (
                <LoadingState rows={3} />
              ) : traces.length === 0 ? (
                <EmptyState title="No observations yet" />
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Trace</th>
                        <th>Experiment</th>
                        <th>Source</th>
                        <th>Status</th>
                        <th>Metrics / checks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {traces.map((trace) => (
                        <tr key={trace.id}>
                          <td>
                            <button
                              className={styles.traceButton}
                              onClick={() => setReviewTrace(trace.id)}
                            >
                              <code>{trace.id}</code>
                            </button>
                          </td>
                          <td>
                            <code>{trace.experimentId}</code>
                          </td>
                          <td>{trace.source}</td>
                          <td>{trace.status}</td>
                          <td>
                            <code>
                              {JSON.stringify({
                                ...trace.metrics,
                                ...trace.checks,
                              })}
                            </code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            {reviewTrace && (
              <TraceReview
                key={`${selected}:${reviewTrace}`}
                appId={selected}
                traceId={reviewTrace}
                admin={admin}
                onClose={() => setReviewTrace("")}
              />
            )}
            <section className={`surface-card ${styles.card}`}>
              <h2 className={`${styles.heading} ${styles.headingRow}`}>
                Compare experiments
                <InfoTip label="Comparison requirements" align="start">
                  Both experiments need complete case sets from the same
                  finalized dataset and mode.
                </InfoTip>
              </h2>
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
                  disabled={busy || !left || !right}
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
                      setError(
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
              {detailLoaded === selected && comparable.length < 2 ? (
                <p className={styles.note}>Needs two experiments.</p>
              ) : null}
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
                          {check.before === null
                            ? "Unknown"
                            : String(check.before)}{" "}
                          ({check.beforeResult}) →{" "}
                          {check.after === null
                            ? "Unknown"
                            : String(check.after)}{" "}
                          ({check.afterResult})
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
