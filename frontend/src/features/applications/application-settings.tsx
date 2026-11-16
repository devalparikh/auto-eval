"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { InfoTip } from "@/components/info-tip";
import { PageHeader } from "@/components/page-header";
import { LoadingState } from "@/components/states";
import { Select } from "@/components/select";
import { apiRequest } from "@/lib/api";
import type { Application, CaptureSettings } from "./application-types";
import styles from "./applications.module.css";

export function ApplicationSettings({ appId }: { appId: string }) {
  const [application, setApplication] = useState<Application | null>(null);
  const [draft, setDraft] = useState<CaptureSettings | null>(null);
  const [policies, setPolicies] = useState<
    { id: string; categories: string[] }[]
  >([]);
  const [admin, setAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [eraseConfirm, setEraseConfirm] = useState(false);
  const pending = useRef(false),
    mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiRequest<Application[]>("/applications", { signal: controller.signal }),
      apiRequest<{ role: string }>("/auth/session", {
        signal: controller.signal,
      }),
      (async () => {
        const all: { id: string; categories: string[] }[] = [];
        let after = "";
        for (;;) {
          const page = await apiRequest<{ id: string; categories: string[] }[]>(
            `/applications/${appId}/policy-categories${after ? "?after=" + after : ""}`,
            { signal: controller.signal },
          );
          all.push(...page);
          if (page.length < 100) return all;
          const next = page[page.length - 1].id;
          if (next <= after || all.length > 10000)
            throw new Error("Invalid declaration page");
          after = next;
        }
      })(),
    ])
      .then(([apps, user, items]) => {
        if (controller.signal.aborted) return;
        const app = apps.find((item) => item.id === appId);
        if (!app) throw new Error("missing");
        setApplication(app);
        setDraft(app.settings);
        setPolicies(items);
        setAdmin(user.role === "admin");
        setLoaded(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("Settings couldn’t load. Return to Applications and refresh.");
          setLoaded(true);
        }
      });
    return () => controller.abort();
  }, [appId, revision]);
  async function save() {
    if (pending.current || !application || !draft) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest(`/applications/${appId}/settings`, {
        method: "PUT",
        body: draft,
        headers: { "if-match": application.settingsVersion },
      });
      if (mounted.current) {
        setMessage("Settings saved.");
        setLoaded(false);
        setRevision((value) => value + 1);
      }
    } catch {
      if (mounted.current)
        setError("Save not confirmed. Reload settings before trying again.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function erase() {
    if (pending.current || !eraseConfirm) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/applications/${appId}/content`, { method: "DELETE" });
      if (mounted.current) {
        setMessage("Diagnostic content deleted.");
        setEraseConfirm(false);
      }
    } catch {
      if (mounted.current)
        setError("Deletion not confirmed. Refresh before trying again.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const categories = [
    ...new Set([
      ...(draft?.content_categories ?? []),
      ...policies.flatMap((policy) => policy.categories),
    ]),
  ].sort();
  return (
    <div className={styles.screen}>
      <PageHeader
        title={
          application ? `${application.name} settings` : "Application settings"
        }
        action={
          <Link className="app-button secondary" href="/applications">
            Applications
          </Link>
        }
      />
      <div className={styles.body}>
        {error && (
          <p role="alert" className={styles.note}>
            {error}
          </p>
        )}
        {message && (
          <p role="status" className={styles.note}>
            {message}
          </p>
        )}
        {!loaded ? (
          <LoadingState rows={3} />
        ) : !admin ? (
          <p>Only an admin can change these settings.</p>
        ) : (
          draft && (
            <>
              <form
                className={`surface-card ${styles.card} ${styles.settingsForm}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <fieldset disabled={busy} className={styles.fieldset}>
                  <div className={styles.headingRow}>
                  <label className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={draft.production_enabled}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          production_enabled: event.target.checked,
                        })
                      }
                    />
                    Allow production capture
                  </label>
                  <InfoTip label="Production capture details" align="start">
                    Every capture still needs the user’s consent in the app.
                  </InfoTip>
                  </div>
                  <div className={styles.row}>
                    {(
                      ["retention_days", "content_retention_days"] as const
                    ).map((field) => (
                      <div className="field" key={field}>
                        <label htmlFor={field}>
                          {field === "retention_days"
                            ? "All evidence retention"
                            : "Diagnostic content retention"}
                        </label>
                        <Select
                          id={field}
                          value={draft[field] === null ? "keep" : "days"}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              [field]:
                                event.target.value === "keep" ? null : 90,
                            })
                          }
                        >
                          <option value="keep">Keep</option>
                          <option value="days">Choose days</option>
                        </Select>
                        {draft[field] !== null && (
                          <input
                            aria-label={`${field === "retention_days" ? "All evidence" : "Diagnostic content"} days`}
                            className="app-input"
                            type="number"
                            required
                            min={1}
                            max={3650}
                            value={draft[field] ?? ""}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                [field]: Number(event.target.value),
                              })
                            }
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  <h2 className={`${styles.heading} ${styles.headingRow}`}>
                    Content categories
                    <InfoTip label="Category details" align="start">
                      The app’s SDK declares categories. New ones stay off
                      until enabled here, and users consent to each one.
                      Shorter retention applies to existing evidence; longer
                      retention only to new evidence.
                    </InfoTip>
                  </h2>
                  {policies.length === 0 && (
                    <p className={styles.note}>None declared yet.</p>
                  )}
                  {categories.map((category) => (
                    <label className={styles.checkRow} key={category}>
                      <input
                        type="checkbox"
                        checked={
                          draft.content_categories?.includes(category) ?? false
                        }
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            content_categories: event.target.checked
                              ? [
                                  ...(draft.content_categories ?? []),
                                  category,
                                ].sort()
                              : (draft.content_categories ?? []).filter(
                                  (item) => item !== category,
                                ),
                          })
                        }
                      />
                      {category.replaceAll("_", " ")}
                    </label>
                  ))}
                  <div className={styles.row}>
                    <button className="app-button">Save settings</button>
                    <button
                      type="button"
                      className="app-button secondary"
                      onClick={() => {
                        setError("");
                        setLoaded(false);
                        setRevision((value) => value + 1);
                      }}
                    >
                      Reload settings
                    </button>
                  </div>
                </fieldset>
              </form>
              <section className={`surface-card ${styles.card}`}>
                <h2 className={`${styles.heading} ${styles.headingRow}`}>
                  Delete diagnostic content
                  <InfoTip label="Deletion details" align="start">
                    Deletes this app’s stored conversation and evidence
                    content. Summaries, outcomes and assessments stay. Existing
                    traces can’t receive new content; new runs still can.
                  </InfoTip>
                </h2>
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={eraseConfirm}
                    disabled={busy}
                    onChange={(event) => setEraseConfirm(event.target.checked)}
                  />
                  Delete this app’s stored diagnostic content
                </label>
                <button
                  className="app-button secondary"
                  disabled={!eraseConfirm || busy}
                  onClick={() => void erase()}
                >
                  Delete content
                </button>
              </section>
            </>
          )
        )}
      </div>
    </div>
  );
}
