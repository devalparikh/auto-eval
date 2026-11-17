"use client";

import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { InfoTip } from "@/components/info-tip";
import { Select } from "@/components/select";
import type { AppKey } from "./application-types";
import { KeyLifespan, type Lifespan } from "./key-lifespan";
import styles from "./applications.module.css";

/**
 * The application's connection: where the SDK sends traces, the settings it
 * reads, and the keys it may use. Before the first trace arrives this is the
 * next step, so it leads; afterwards it is maintenance and sits last.
 */
export function ApplicationKeys({
  appName,
  endpoint,
  keys,
  clock,
  leading,
  busy,
  locked,
  validLifetime,
  lifespan,
  customDays,
  onLifespan,
  onCustomDays,
  overlap,
  onOverlap,
  secret,
  onHideSecret,
  onIssue,
  onRotate,
  onRevoke,
}: {
  appName: string;
  endpoint: string;
  keys: readonly AppKey[];
  clock: number;
  /** True while nothing has arrived yet: the card is the next step. */
  leading: boolean;
  busy: boolean;
  /** A write whose outcome is unknown; every write waits for a refresh. */
  locked: boolean;
  validLifetime: boolean;
  lifespan: Lifespan;
  customDays: string;
  onLifespan: (value: Lifespan) => void;
  onCustomDays: (value: string) => void;
  overlap: string;
  onOverlap: (value: string) => void;
  secret: string;
  onHideSecret: () => void;
  onIssue: () => void;
  onRotate: (key: AppKey) => void;
  onRevoke: (key: AppKey) => void;
}) {
  const [copied, setCopied] = useState("");
  const [lastSecret, setLastSecret] = useState(secret);
  if (lastSecret !== secret) {
    setLastSecret(secret);
    setCopied("");
  }
  const env = [
    "AUTOEVAL_ENABLED=true",
    `AUTOEVAL_ENDPOINT=${endpoint}`,
    `AUTOEVAL_INGEST_KEY=${secret || "<application key>"}`,
    "AUTOEVAL_SOURCE=production",
  ].join("\n");

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied("");
    }
  }

  return (
    <section
      className={`surface-card ${styles.card}`}
      aria-labelledby="connection-heading"
    >
      <div className={styles.cardHead}>
        <div>
          <h2
            id="connection-heading"
            className={`${styles.heading} ${styles.headingRow}`}
          >
            {leading ? `Connect ${appName}` : "Application keys"}
            <InfoTip label="SDK settings" align="start">
              The SDK’s <code>createCaptureFromEnv()</code> reads these on the
              app’s server. Use <code>synthetic</code> as the source for test
              traffic.
            </InfoTip>
          </h2>
          {leading ? (
            <p className={styles.note}>
              Set these on {appName}’s server, deploy, then send one request.
              The key never goes to a browser.
            </p>
          ) : null}
        </div>
      </div>

      <div className={styles.envBlock}>
        <pre aria-label="SDK environment">
          <code>{env}</code>
        </pre>
        <button
          type="button"
          className="app-button secondary"
          onClick={() => void copy("env", env)}
        >
          {copied === "env" ? (
            <CheckIcon size={13} aria-hidden="true" />
          ) : (
            <CopyIcon size={13} aria-hidden="true" />
          )}
          {copied === "env" ? "Copied" : "Copy settings"}
        </button>
      </div>
      <div className={styles.endpoint}>
        <span>Endpoint</span>
        <code>{endpoint}</code>
      </div>

      {secret && (
        <div role="status" className={styles.secret}>
          <p className={styles.headingRow}>
            New key, shown once
            <InfoTip label="Key storage" align="start">
              Store it on the app’s server as <code>AUTOEVAL_INGEST_KEY</code>.
              Never send it to a browser.
            </InfoTip>
          </p>
          <code>{secret}</code>
          <div className="flex gap-2">
            <button
              type="button"
              className="app-button secondary"
              onClick={() => void copy("key", secret)}
            >
              {copied === "key" ? (
                <CheckIcon size={13} aria-hidden="true" />
              ) : (
                <CopyIcon size={13} aria-hidden="true" />
              )}
              {copied === "key" ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              className="app-button secondary"
              onClick={onHideSecret}
            >
              Hide key
            </button>
          </div>
        </div>
      )}

      <div className={styles.row}>
        <KeyLifespan
          id="key-lifespan"
          lifespan={lifespan}
          customDays={customDays}
          onLifespan={onLifespan}
          onCustomDays={onCustomDays}
        />
      </div>
      <div className={styles.row}>
        <div className="field">
          <label htmlFor="rotation-overlap">Rotation overlap</label>
          <Select
            id="rotation-overlap"
            value={overlap}
            onChange={(event) => onOverlap(event.target.value)}
          >
            <option value="1">1 hour</option>
            <option value="24">24 hours</option>
            <option value="0">Revoke old key immediately</option>
          </Select>
        </div>
        <button
          type="button"
          className="app-button"
          disabled={busy || locked || !validLifetime}
          onClick={onIssue}
        >
          Issue key
        </button>
      </div>
      {keys.length === 0 ? (
        <p className={styles.note}>No keys yet.</p>
      ) : (
        <ul className={styles.keys}>
          {keys.map((key) => {
            const expired = key.expiresAt !== null && key.expiresAt <= clock;
            const retired = Boolean(key.retireAt && key.retireAt <= clock);
            return (
              <li key={key.id}>
                <code>{key.id}</code>
                <span>{key.label}</span>
                <span className={styles.keyState}>
                  {key.revoked
                    ? "Revoked"
                    : expired
                      ? "Expired"
                      : retired
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
                        busy || locked || !validLifetime || expired || retired
                      }
                      onClick={() => onRotate(key)}
                    >
                      Rotate
                    </button>
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={busy || locked}
                      onClick={() => onRevoke(key)}
                    >
                      Revoke
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
