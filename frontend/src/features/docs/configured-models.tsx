"use client";

import { useCatalog } from "@/lib/use-catalog";
import styles from "./docs.module.css";

/** The LM Studio models this workspace has configured, read from the catalog. */
export function ConfiguredModels() {
  const catalog = useCatalog();
  const local =
    catalog.data?.models.filter((model) => model.provider === "lmstudio") ??
    [];
  const status = catalog.loading
    ? "Reading configured models…"
    : catalog.error
      ? "Start the AutoEval backend to see configured local models."
      : local.length
        ? "Configured in this workspace. A run checks that the server is up."
        : "No LM Studio models are configured in this workspace yet.";

  return (
    <div className={styles.configured} aria-live="polite">
      <div className={styles.configuredHead}>
        <p>{status}</p>
        <button
          type="button"
          className={styles.copy}
          disabled={catalog.loading}
          onClick={() => void catalog.reload()}
        >
          Refresh
        </button>
      </div>
      {local.length ? (
        <ul>
          {local.map((model) => (
            <li key={model.id}>{model.id}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
