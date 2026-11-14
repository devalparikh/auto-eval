"use client";

import { useEffect, useState } from "react";
import { API_URL, apiRequest } from "@/lib/api";

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
  return (
    <main className="page-container" style={{ padding: 32 }}>
      <h1>Applications</h1>
      <p>
        Application-owned inference. Metadata-only observations expire with
        consent or retention.
      </p>
      <button
        disabled={busy}
        onClick={() => {
          setError("");
          setComparison(null);
          setRevision((value) => value + 1);
        }}
      >
        Refresh
      </button>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">Loading applications…</p>
      ) : apps.length === 0 ? (
        <p>No applications registered.</p>
      ) : (
        <label>
          Application
          <select
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
          </select>
        </label>
      )}
      {admin && (
        <details>
          <summary>Register application</summary>
          <form
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
            <label>
              Name
              <input
                required
                maxLength={96}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Environment
              <input
                required
                pattern="[a-z][a-z0-9_]{0,47}"
                value={environment}
                onChange={(event) => setEnvironment(event.target.value)}
              />
            </label>
            <p>
              Seven-day retention. Policy: latency_ms and passed. Use the API to
              register a different immutable policy.
            </p>
            <button disabled={busy}>Register</button>
          </form>
        </details>
      )}
      {selected && (
        <>
          {admin && (
            <section
              className="surface-card"
              style={{ padding: 24, marginTop: 24 }}
            >
              <h2>Application keys</h2>
              <p>
                Ingest endpoint: <code>{ingestEndpoint}</code>
              </p>
              <label>
                Permission
                <select
                  value={scope}
                  onChange={(event) => setScope(event.target.value)}
                >
                  <option>traces:write</option>
                  <option>grants:write</option>
                  <option>traces:read</option>
                </select>
              </label>
              <button
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
              {secret && (
                <div role="status">
                  <p>Copy this key now. It is shown once.</p>
                  <code>{secret}</code>
                  <button onClick={() => setSecret("")}>Hide key</button>
                </div>
              )}
              <ul>
                {keys.map((key) => (
                  <li key={key.id}>
                    <code>{key.id}</code> {key.scope} —{" "}
                    {key.revoked
                      ? "Revoked"
                      : `Expires ${new Date(key.expires * 1000).toLocaleDateString()}`}
                    {!key.revoked && (
                      <>
                        <button
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
                          disabled={busy}
                          onClick={() =>
                            void mutate(
                              `/applications/${selected}/keys/${key.id}/revoke`,
                            )
                          }
                        >
                          Revoke
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section
            className="surface-card"
            style={{ padding: 24, marginTop: 24, overflowX: "auto" }}
          >
            <h2>Recent observations</h2>
            <p>
              Up to 100 unexpired observations. Consent withdrawal removes
              associated observations.
            </p>
            {detailLoaded !== selected ? (
              <p role="status">Loading observations…</p>
            ) : traces.length === 0 ? (
              <p>No observations available.</p>
            ) : (
              <table>
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
            )}
          </section>
          <section
            className="surface-card"
            style={{ padding: 24, marginTop: 24 }}
          >
            <h2>Compare experiments</h2>
            <p>
              Requires complete synthetic case sets from the same finalized
              dataset and mode.
            </p>
            <label>
              Baseline
              <select
                disabled={busy}
                value={left}
                onChange={(event) => {
                  setLeft(event.target.value);
                  setComparison(null);
                }}
              >
                <option value="">Select experiment</option>
                {experiments
                  .filter((run) => run.mode !== "observed")
                  .map((run) => (
                    <option key={run.id} value={run.id}>
                      {run.model} / {run.id}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Candidate
              <select
                disabled={busy}
                value={right}
                onChange={(event) => {
                  setRight(event.target.value);
                  setComparison(null);
                }}
              >
                <option value="">Select experiment</option>
                {experiments
                  .filter((run) => run.mode !== "observed")
                  .map((run) => (
                    <option key={run.id} value={run.id}>
                      {run.model} / {run.id}
                    </option>
                  ))}
              </select>
            </label>
            <button
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
            {comparison && (
              <div>
                <p>Mode: {comparison.mode}</p>
                {comparison.cases.map((item) => (
                  <div key={item.id}>
                    <code>{item.id}</code>
                    <p>
                      {item.beforeStatus} → {item.afterStatus}
                    </p>
                    {item.checks.map((check) => (
                      <p key={check.name}>
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
    </main>
  );
}
