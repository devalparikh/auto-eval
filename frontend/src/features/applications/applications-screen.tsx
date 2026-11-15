"use client";

import { ArrowClockwiseIcon, PlusIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TraceReview } from "./trace-review";
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
  const [lifespan, setLifespan] = useState("30");
  const [overlap, setOverlap] = useState("1");
  const [clock, setClock] = useState(0);
  const validLifetime =
    Number.isInteger(Number(lifespan)) &&
    Number(lifespan) >= 1 &&
    Number(lifespan) <= 90;
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
              "Application creation is confirmed. Review its keys; the previous one-time token cannot be retrieved.",
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
      }
      setRevision((value) => value + 1);
    } catch {
      if (!mounted.current) return;
      setUncertain(true);
      setError(
        "The operation was not confirmed. Refresh the list before trying again; a key may have been created.",
      );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const comparable = experiments.filter((run) => run.mode !== "observed");
  const current = apps.find((app) => app.id === selected);
  return (
    <div className={styles.screen}>
      <PageHeader
        title="Applications"
        description="Observations from applications that run their own inference. Settings and consent control capture."
        action={
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
          <section className={`surface-card ${styles.card}`}>
            <EmptyState
              title={
                admin
                  ? "No applications yet"
                  : "No applications shared with you"
              }
              message={
                admin
                  ? "Register an application to issue its keys and start receiving observations."
                  : "Ask the instance operator to give you access to an application."
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
        {/* With no applications the empty state offers registration, so the
            form stays out of sight until it is asked for. */}
        {admin && (apps.length > 0 || registerOpen) && (
          <details
            className={`surface-card ${styles.card} ${styles.register}`}
            open={registerOpen}
            onToggle={(event) => setRegisterOpen(event.currentTarget.open)}
          >
            <summary>
              <PlusIcon size={13} aria-hidden="true" />
              Register application
            </summary>
            <form
              className={styles.registerForm}
              onSubmit={(event) => {
                event.preventDefault();
                createId.current ??= crypto.randomUUID();
                void mutate("/applications", {
                  id: createId.current,
                  name,
                  key: {
                    expiresAt: Date.now() + Number(lifespan) * 86400000,
                  },
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
              <div className="field">
                <label htmlFor="application-lifespan">
                  Key lifespan (days)
                </label>
                <input
                  id="application-lifespan"
                  className="app-input mono"
                  required
                  type="number"
                  min={1}
                  max={90}
                  value={lifespan}
                  onChange={(event) => setLifespan(event.target.value)}
                />
              </div>
              <p className={styles.note}>
                The SDK registers policy and experiments automatically. App
                settings can be changed after creation.
              </p>
              <button
                className="app-button"
                disabled={busy || uncertain || !validLifetime}
              >
                Register
              </button>
            </form>
          </details>
        )}
        {apps.length > 0 && !selected && !loading ? (
          <section className={`surface-card ${styles.card}`}>
            <EmptyState
              title="Choose an application"
              message={
                admin
                  ? "Its observations, keys, and experiment comparisons appear here."
                  : "Its observations and experiment comparisons appear here."
              }
            />
          </section>
        ) : null}
        {selected && (
          <>
            {admin && (
              <section className={`surface-card ${styles.card}`}>
                <h2 className={styles.heading}>Application keys</h2>
                <div className={styles.endpoint}>
                  <span>AUTOEVAL_ENDPOINT</span>
                  <code>{ingestEndpoint}</code>
                </div>
                <p className={styles.note}>
                  Set AUTOEVAL_ENABLED=true and AUTOEVAL_SOURCE=production in
                  the app backend. The SDK supplies policy and experiment IDs.
                  User consent is off until granted in the app. Production and
                  retention are separate app settings.
                </p>
                <div className={styles.row}>
                  <div className="field">
                    <label htmlFor="key-lifespan">Key lifespan (days)</label>
                    <input
                      id="key-lifespan"
                      className="app-input"
                      type="number"
                      min={1}
                      max={90}
                      value={lifespan}
                      onChange={(event) => setLifespan(event.target.value)}
                    />
                  </div>
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
                        expiresAt: Date.now() + Number(lifespan) * 86400000,
                      })
                    }
                  >
                    Issue key
                  </button>
                </div>
                {secret && (
                  <div role="status" className={styles.secret}>
                    <p>
                      Copy this key to the app’s server-only
                      AUTOEVAL_INGEST_KEY. It is shown once.
                    </p>
                    <code>{secret}</code>
                    <button
                      type="button"
                      className="app-button secondary"
                      onClick={() => setSecret("")}
                    >
                      Hide key
                    </button>
                  </div>
                )}
                {keys.length === 0 ? (
                  <p className={styles.note}>
                    No keys issued. Start with <code>application:connect</code>{" "}
                    to send observations.
                  </p>
                ) : (
                  <ul className={styles.keys}>
                    {keys.map((key) => (
                      <li key={key.id}>
                        <code>{key.id}</code>
                        <span>{key.label}</span>
                        <span className={styles.keyState}>
                          {key.revoked
                            ? "Revoked"
                            : key.expiresAt <= clock
                              ? "Expired"
                              : key.retireAt && key.retireAt <= clock
                                ? "Retired"
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
                                key.expiresAt <= clock ||
                                Boolean(key.retireAt && key.retireAt <= clock)
                              }
                              onClick={() =>
                                void mutate(
                                  `/applications/${selected}/keys/${key.id}/rotate`,
                                  {
                                    expiresAt:
                                      Date.now() + Number(lifespan) * 86400000,
                                    retireAt: Number(overlap)
                                      ? Math.min(
                                          Date.now() +
                                            Number(overlap) * 3600000,
                                          key.expiresAt,
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
              <h2 className={styles.heading}>Recent observations</h2>
              <p className={styles.note}>
                Up to 100 unexpired observations. Consent withdrawal removes
                associated observations.
              </p>
              {detailLoaded !== selected ? (
                <LoadingState rows={3} />
              ) : traces.length === 0 ? (
                <EmptyState
                  title="No observations yet"
                  message={
                    admin
                      ? "Connect the SDK with this app’s key. Consented observations appear here."
                      : "Observations appear here once the application sends them."
                  }
                />
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
              <h2 className={styles.heading}>Compare experiments</h2>
              <p className={styles.note}>
                Requires complete synthetic case sets from the same finalized
                dataset and mode.
              </p>
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
                        "Comparison unavailable. Check dataset, mode, consent, and complete case coverage.",
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
                <p className={styles.note}>
                  Register two scripted or live experiments on the same
                  finalized dataset to compare them.
                </p>
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
