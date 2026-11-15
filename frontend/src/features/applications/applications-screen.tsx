"use client";

import { ArrowClockwiseIcon, PlusIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Select } from "@/components/select";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { API_URL, apiRequest } from "@/lib/api";
import styles from "./applications.module.css";

type Application = {
  id: string;
  name: string;
  environment: string;
  retention_days: number;
};
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
  model: string;
  mode: string;
  datasetHash: string | null;
};
type Comparison = {
  mode: string;
  cases: {
    id: string;
    beforeStatus: string;
    afterStatus: string;
    checks: { name: string; before: boolean | null; after: boolean | null }[];
  }[];
};
type Key = { id: string; scope: string; revoked: boolean; expires: number };

export function ApplicationsScreen() {
  const [ingestEndpoint, setIngestEndpoint] = useState("");
  const [apps, setApps] = useState<Application[]>([]);
  const [selected, setSelected] = useState("");
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
  const [error, setError] = useState("");
  const [secret, setSecret] = useState("");
  const [revision, setRevision] = useState(0);
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState("preview");
  const [scope, setScope] = useState("traces:write");
  const [registerOpen, setRegisterOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiRequest<Application[]>("/applications", { signal: controller.signal }),
      apiRequest<{ role: string }>("/auth/session", {
        signal: controller.signal,
      }),
    ])
      .then(([items, user]) => {
        if (!controller.signal.aborted) {
          setIngestEndpoint(
            new URL(
              API_URL.replace(/\/api$/, "") + "/v1/traces",
              window.location.origin,
            ).href,
          );
          setApps(items);
          setAdmin(user.role === "admin");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
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
    Promise.all([
      apiRequest<Observation[]>(`/applications/${selected}/traces`, {
        signal: controller.signal,
      }),
      admin
        ? apiRequest<Key[]>(`/applications/${selected}/keys`, {
            signal: controller.signal,
          })
        : Promise.resolve([]),
      apiRequest<Experiment[]>(`/applications/${selected}/experiments`, {
        signal: controller.signal,
      }),
    ])
      .then(([items, issued, runs]) => {
        if (!controller.signal.aborted) {
          setTraces(items);
          setKeys(issued);
          setExperiments(runs);
          setDetailLoaded(selected);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "Application data could not be loaded. Refresh to try again.",
          );
      });
    return () => controller.abort();
  }, [selected, admin, revision]);
  async function mutate(path: string, body?: unknown) {
    if (busy) return;
    setBusy(true);
    setError("");
    setSecret("");
    try {
      const result = await apiRequest<{ token?: string }>(path, {
        method: "POST",
        body,
      });
      if (result.token) setSecret(result.token);
      setRevision((value) => value + 1);
    } catch {
      setError(
        "The operation was not confirmed. Refresh the list before trying again; a key may have been created.",
      );
    } finally {
      setBusy(false);
    }
  }
  const comparable = experiments.filter((run) => run.mode !== "observed");
  const current = apps.find((app) => app.id === selected);
  return (
    <div className={styles.screen}>
      <PageHeader
        title="Applications"
        description="Metadata-only observations from applications that run their own inference. Observations expire with consent or retention."
        action={
          <button
            type="button"
            className="app-button secondary"
            disabled={busy}
            onClick={() => {
              setError("");
              setComparison(null);
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
            <ErrorState className="" title="Something went wrong" message={error} />
          </div>
        )}
        {loading ? (
          <LoadingState rows={2} />
        ) : apps.length === 0 ? (
          <section className={`surface-card ${styles.card}`}>
            <EmptyState
              title={admin ? "No applications yet" : "No applications shared with you"}
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
                    {app.name} / {app.environment}
                  </option>
                ))}
              </Select>
            </div>
            {current ? (
              <dl className={styles.facts}>
                <div>
                  <dt>Environment</dt>
                  <dd className="mono">{current.environment}</dd>
                </div>
                <div>
                  <dt>Retention</dt>
                  <dd className="mono">{current.retention_days}d</dd>
                </div>
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
                void mutate("/applications", {
                  id: crypto.randomUUID(),
                  name,
                  environment,
                  policy: { metrics: ["latency_ms"], checks: ["passed"] },
                  retention_days: 7,
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
                <label htmlFor="application-environment">Environment</label>
                <input
                  id="application-environment"
                  className="app-input mono"
                  required
                  pattern="[a-z][a-z0-9_]{0,47}"
                  value={environment}
                  onChange={(event) => setEnvironment(event.target.value)}
                />
              </div>
              <p className={styles.note}>
                Seven-day retention. Policy: <code>latency_ms</code> and{" "}
                <code>passed</code>. Registration is immutable; use the API to
                register a different policy.
              </p>
              <button className="app-button" disabled={busy}>
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
                  <span>Ingest endpoint</span>
                  <code>{ingestEndpoint}</code>
                </div>
                <div className={styles.row}>
                  <div className="field">
                    <label htmlFor="key-scope">Permission</label>
                    <Select
                      id="key-scope"
                      value={scope}
                      onChange={(event) => setScope(event.target.value)}
                    >
                      <option>traces:write</option>
                      <option>grants:write</option>
                      <option>traces:read</option>
                    </Select>
                  </div>
                  <button
                    type="button"
                    className="app-button"
                    disabled={busy}
                    onClick={() =>
                      void mutate(`/applications/${selected}/keys`, {
                        scope,
                        expires_in_days: 30,
                      })
                    }
                  >
                    Issue key
                  </button>
                </div>
                {secret && (
                  <div role="status" className={styles.secret}>
                    <p>Copy this key now. It is shown once.</p>
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
                    No keys issued. Start with <code>traces:write</code> to send
                    observations.
                  </p>
                ) : (
                  <ul className={styles.keys}>
                    {keys.map((key) => (
                      <li key={key.id}>
                        <code>{key.id}</code>
                        <span className="mono">{key.scope}</span>
                        <span className={styles.keyState}>
                          {key.revoked
                            ? "Revoked"
                            : `Expires ${new Date(key.expires * 1000).toLocaleDateString()}`}
                        </span>
                        {!key.revoked && (
                          <span className={styles.keyActions}>
                            <button
                              type="button"
                              className="app-button secondary"
                              disabled={busy}
                              onClick={() =>
                                void mutate(
                                  `/applications/${selected}/keys/${key.id}/rotate`,
                                )
                              }
                            >
                              Rotate
                            </button>
                            <button
                              type="button"
                              className="app-button secondary"
                              disabled={busy}
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
                      ? "Issue a traces:write key and send metadata-only traces to the ingest endpoint."
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
                            <code>{trace.id}</code>
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
                        {run.model} / {run.id}
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
                        {run.model} / {run.id}
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
                      {item.checks.map((check) => (
                        <p key={check.name} className="mono">
                          {check.name}: {String(check.before)} →{" "}
                          {String(check.after)}
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
