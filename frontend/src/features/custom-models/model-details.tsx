"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { api, API_URL } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Catalog, CustomModel } from "@/lib/types";
import styles from "./custom-models.module.css";

export function ModelDetails({
  model,
  catalog,
  canTrain,
  trainBlockedReason,
  trainBlockedHint,
  environment,
  actionError,
  busy,
  onAction,
  onCopy,
}: {
  model: CustomModel;
  catalog: Catalog;
  canTrain: boolean;
  /** Why "Start fine-tuning" is disabled, as the button's tooltip. */
  trainBlockedReason: string | null;
  /** The same reason as a line in the details, when `environment` does not already say it. */
  trainBlockedHint: string | null;
  environment: ReactNode;
  actionError: string | null;
  busy: boolean;
  onAction: (operation: () => Promise<CustomModel>) => void;
  onCopy: () => void;
}) {
  const [name, setName] = useState(model.name);
  const dataset = catalog.datasets.find((item) =>
    item.versions.some((version) => version.id === model.dataset_version_id),
  );
  const version = dataset?.versions.find(
    (item) => item.id === model.dataset_version_id,
  );
  const system = catalog.agent_systems.find(
    (item) => item.id === model.agent_system_id,
  );
  const active = model.status === "queued" || model.status === "running";

  const started = active || model.completed_steps > 0;

  return (
    <>
      <PageHeader
        title={model.name}
        description={model.base_model}
        action={
          <div className={styles.headerActions}>
            <StatusBadge status={model.status} />
            {model.status === "draft" && !model.archived && (
              <button
                className="app-button"
                disabled={busy || !canTrain}
                title={trainBlockedReason ?? undefined}
                onClick={() => onAction(() => api.trainCustomModel(model.id))}
              >
                Start fine-tuning
              </button>
            )}
            {active && (
              <button
                className="app-button secondary"
                disabled={busy}
                onClick={() => onAction(() => api.cancelCustomModel(model.id))}
              >
                Cancel training
              </button>
            )}
            {model.status === "complete" && (
              <a
                className="app-button"
                href={`${API_URL}/custom-models/${model.id}/artifacts`}
              >
                Download adapter
              </a>
            )}
          </div>
        }
      />
      <div className={styles.body}>
        {environment}
        {actionError && (
          <p role="alert" className={styles.error}>
            {actionError}
          </p>
        )}
        <article className={styles.detail} aria-label="Model details">
      {model.status === "draft" && !model.archived && trainBlockedHint && (
        <p className={styles.hint}>{trainBlockedHint}</p>
      )}
      <dl className={styles.facts}>
        <div>
          <dt>Dataset</dt>
          <dd>
            <Link href={`/systems/${system?.key ?? ""}/datasets`}>
              {dataset?.name ?? "Dataset"}{" "}
              <span className="mono">v{version?.version ?? "—"}</span>
            </Link>
          </dd>
        </div>
        <div>
          <dt>Examples</dt>
          <dd>
            <span className="mono">{model.train_count}</span> training /{" "}
            <span className="mono">{model.validation_count}</span> validation
          </dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd className="mono">{formatDate(model.created_at)}</dd>
        </div>
      </dl>
      {started && (
        <div className={styles.progressSection}>
          <div className={styles.progressLabel}>
            <span>{active ? "Training progress" : "Training steps"}</span>
            <span className="mono">
              {model.completed_steps} / {model.training_config.steps}
            </span>
          </div>
          <progress
            aria-label="Training progress"
            max={model.training_config.steps}
            value={model.completed_steps}
          />
          {active && model.completed_steps === 0 && (
            <p className={styles.hint}>
              Preparing examples and loading the base model. The first download
              may take several minutes.
            </p>
          )}
          {model.training_loss !== null || model.validation_loss !== null ? (
            <div className={styles.losses}>
              <div>
                <span>Training loss</span>
                <strong>{model.training_loss?.toFixed(4) ?? "—"}</strong>
              </div>
              <div>
                <span>Validation loss</span>
                <strong>{model.validation_loss?.toFixed(4) ?? "—"}</strong>
              </div>
            </div>
          ) : null}
        </div>
      )}
      {model.error && (
        <p role="alert" className={styles.error}>
          {model.error}
        </p>
      )}
      {model.status === "complete" && (
        <p className={styles.hint}>
          Adapter weights are ready to download with their base revision and
          training manifest. Benchmarks cannot select this model yet.
        </p>
      )}
      <details className={styles.advanced}>
        <summary>Training recipe & provenance</summary>
        <dl className={styles.facts}>
          <div>
            <dt>Runs on</dt>
            <dd>This Mac · MLX</dd>
          </div>
          <div>
            <dt>Training steps</dt>
            <dd className="mono">{model.training_config.steps}</dd>
          </div>
          <div>
            <dt>Learning rate</dt>
            <dd className="mono">{model.training_config.learning_rate}</dd>
          </div>
          <div>
            <dt>Batch / rank / seed</dt>
            <dd className="mono">
              {model.training_config.batch_size} /{" "}
              {model.training_config.lora_rank} / {model.training_config.seed}
            </dd>
          </div>
          <div>
            <dt>Sequence limit</dt>
            <dd className="mono">{model.training_config.max_seq_length}</dd>
          </div>
          <div>
            <dt>Base revision</dt>
            <dd className="mono">
              {model.resolved_revision ??
                `${model.base_revision} (resolves at training)`}
            </dd>
          </div>
          <div>
            <dt>Dataset hash</dt>
            <dd className="mono">{model.dataset_hash}</dd>
          </div>
          <div>
            <dt>Recipe hash</dt>
            <dd className="mono">{model.recipe_hash}</dd>
          </div>
        </dl>
        <pre>{model.system_prompt}</pre>
      </details>
      {model.status === "draft" ? null : (
        <details
          className={styles.advanced}
          open={active || model.status === "failed"}
        >
          <summary>Training log</summary>
          <pre className={styles.log}>
            {model.log_tail || "Training has not produced any logs yet."}
          </pre>
        </details>
      )}
      <form
        className={styles.manage}
        onSubmit={(event) => {
          event.preventDefault();
          onAction(() =>
            api.updateCustomModel(model.id, {
              name: name.trim(),
              archived: model.archived,
            }),
          );
        }}
      >
        <div className="field">
          <label htmlFor="rename-model">Display name</label>
          <input
            id="rename-model"
            className="app-input"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <button
          className="app-button secondary"
          disabled={busy || !name.trim() || name.trim() === model.name}
        >
          Rename
        </button>
        <button
          type="button"
          className="app-button secondary"
          disabled={busy || active}
          onClick={() =>
            onAction(() =>
              api.updateCustomModel(model.id, {
                name: model.name,
                archived: !model.archived,
              }),
            )
          }
        >
          {model.archived ? "Restore model" : "Archive model"}
        </button>
        <button
          type="button"
          className="app-button secondary"
          disabled={busy}
          onClick={onCopy}
        >
          Create from this model
        </button>
      </form>
        </article>
      </div>
    </>
  );
}
