"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Modal } from "@/components/modal";
import { Select } from "@/components/select";
import { api } from "@/lib/api";
import type {
  Catalog,
  CreateCustomModel,
  CustomModel,
  TrainingDataPreview,
  TrainingRuntime,
} from "@/lib/types";
import { BaseModelInfo } from "./base-model-info";
import styles from "./custom-models.module.css";

export function CreateModelModal({
  catalog,
  runtime,
  source,
  onClose,
  onCreated,
}: {
  catalog: Catalog;
  runtime: TrainingRuntime;
  source: CustomModel | null;
  onClose: () => void;
  onCreated: (model: CustomModel) => void;
}) {
  const datasets = catalog.datasets.flatMap((dataset) =>
    dataset.versions
      .filter((version) => version.status === "final")
      .map((version) => ({
        ...version,
        dataset,
        system: catalog.agent_systems.find(
          (system) => system.id === dataset.agent_system_id,
        ),
      })),
  );
  const [form, setForm] = useState<CreateCustomModel>({
    name: source ? `${source.name} · next` : "",
    dataset_version_id: source?.dataset_version_id ?? datasets[0]?.id ?? "",
    base_model: source?.base_model ?? runtime.base_models[0]?.id ?? "",
    base_revision: source?.resolved_revision ?? source?.base_revision ?? "main",
    system_prompt:
      source?.system_prompt ??
      "Return the expected JSON output for the provided input.",
    training_config: source?.training_config ?? {
      steps: 100,
      batch_size: 1,
      learning_rate: 0.00001,
      max_seq_length: 2048,
      lora_rank: 8,
      seed: 42,
    },
  });
  const harnessDataset =
    datasets.find((item) => item.id === form.dataset_version_id)?.system
      ?.runtime === "external_harness";
  const [customBase, setCustomBase] = useState(
    Boolean(
      source &&
        !runtime.base_models.some((model) => model.id === source.base_model),
    ),
  );
  const [preview, setPreview] = useState<TrainingDataPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function change(values: Partial<CreateCustomModel>) {
    setForm((current) => ({ ...current, ...values }));
    setPreview(null);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!preview) setPreview(await api.previewTraining(form));
      else onCreated(await api.createCustomModel(form));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not prepare this model",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Create custom model"
      description="Choose a base model and a finalized dataset. Review the training example, then save your model."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} className={styles.form}>
        <fieldset disabled={busy} className={styles.fields}>
          <div className="field">
            <label htmlFor="model-name">Model name</label>
            <input
              id="model-name"
              className="app-input"
              data-autofocus
              required
              maxLength={120}
              placeholder="Incident triage · Qwen"
              value={form.name}
              onChange={(event) => change({ name: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="model-dataset">Finalized dataset</label>
            <Select
              id="model-dataset"
              value={form.dataset_version_id}
              required
              onChange={(event) =>
                change({ dataset_version_id: event.target.value })
              }
            >
              {!datasets.length && (
                <option value="">No finalized datasets</option>
              )}
              {datasets.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.system?.name} / {version.dataset.name} · v
                  {version.version} · {version.item_count} examples
                </option>
              ))}
            </Select>
            {!datasets.length && (
              <p className={styles.hint}>
                Finalize a dataset with at least two distinct inputs in{" "}
                <Link href="/systems">All systems</Link>.
              </p>
            )}
          </div>
          <div className="field">
            <div className={styles.baseHeading}>
              <label htmlFor="model-base" className="field-label">
                Base model
              </label>
              <span className={styles.modelTag} aria-label="Training runtime">
                {runtime.executor === "local_mlx"
                  ? "MLX · local"
                  : runtime.executor}
              </span>
              <BaseModelInfo />
            </div>
            <Select
              id="model-base"
              value={customBase ? "custom" : form.base_model}
              onChange={(event) => {
                setCustomBase(event.target.value === "custom");
                change({
                  base_model:
                    event.target.value === "custom" ? "" : event.target.value,
                });
              }}
            >
              {runtime.base_models.map((model) => (
                <option
                  value={model.id}
                  key={model.id}
                  data-detail={model.description}
                >
                  {model.label}
                </option>
              ))}
              <option value="custom">Other Hugging Face model</option>
            </Select>
            {customBase && (
              <>
                <label htmlFor="model-hub-id">Hugging Face model ID</label>
                <input
                  id="model-hub-id"
                  className="app-input"
                  required
                  placeholder="organization/model-name"
                  value={form.base_model}
                  onChange={(event) =>
                    change({ base_model: event.target.value })
                  }
                />
              </>
            )}
            <div className={styles.modelTags} aria-live="polite">
              <span className={styles.modelTag}>Text model required</span>
              <span className={styles.modelTag}>Chat template required</span>
              {customBase && (
                <span className={styles.modelTag}>
                  {form.base_model.trim()
                    ? "Compatibility unchecked"
                    : "No model selected"}
                </span>
              )}
            </div>
          </div>
          <div className="field">
            <label htmlFor="model-instruction">Training instruction</label>
            {harnessDataset && (
              <p className={styles.hint}>
                Harness datasets preserve their captured instructions and tools.
                This replacement instruction is not used.
              </p>
            )}
            <textarea
              id="model-instruction"
              disabled={harnessDataset}
              className="app-textarea"
              required
              maxLength={16000}
              rows={2}
              value={form.system_prompt}
              onChange={(event) =>
                change({ system_prompt: event.target.value })
              }
            />
          </div>
          <details className={styles.advanced}>
            <summary>Training settings</summary>
            <div className={styles.settingsGrid}>
              {(
                [
                  ["steps", "Training steps", 1, 10000, 1],
                  ["batch_size", "Batch size", 1, 16, 1],
                  ["learning_rate", "Learning rate", 0.0000001, 0.01, "any"],
                  ["max_seq_length", "Maximum sequence length", 128, 8192, 1],
                  ["lora_rank", "LoRA rank", 1, 64, 1],
                  ["seed", "Random seed", 0, 2147483647, 1],
                ] as const
              ).map(([key, label, min, max, step]) => (
                <div className="field" key={key}>
                  <label htmlFor={`model-${key}`}>{label}</label>
                  <input
                    id={`model-${key}`}
                    className="app-input"
                    type="number"
                    required
                    min={min}
                    max={max}
                    step={step}
                    value={form.training_config[key]}
                    onChange={(event) =>
                      change({
                        training_config: {
                          ...form.training_config,
                          [key]: event.target.valueAsNumber,
                        },
                      })
                    }
                  />
                </div>
              ))}
              <div className="field">
                <label htmlFor="model-revision">Base revision</label>
                <input
                  id="model-revision"
                  className="app-input"
                  required
                  maxLength={120}
                  value={form.base_revision}
                  onChange={(event) =>
                    change({ base_revision: event.target.value })
                  }
                />
              </div>
            </div>
          </details>
          <p className={styles.hint}>
            {harnessDataset
              ? "Training uses captured conversations, tool definitions, and the approved assistant response. Choose a base model whose chat template supports the roles and tools in your examples."
              : "Training pairs the input JSON with the reviewed expected JSON. If your dataset contains scoring labels, those labels become the answer. It does not reproduce an agent’s graph or fetch external context."}
          </p>
        </fieldset>
        {preview && (
          <section className={styles.preview} aria-label="Training preview">
            <p>
              <span className="mono">{preview.train_count}</span> training ·{" "}
              <span className="mono">{preview.validation_count}</span>{" "}
              validation ·{" "}
              <span className="mono">{preview.duplicate_count}</span> duplicates
              removed
            </p>
            <p className={styles.hint}>
              {harnessDataset
                ? "Training and validation use separate tasks selected during capture. Benchmark tasks remain held out."
                : "A fixed 10% holdout (at least one example) is reserved for validation."}
            </p>
            {!!preview.sample_tools?.length && (
              <pre>{JSON.stringify(preview.sample_tools, null, 2)}</pre>
            )}
            {preview.sample.map((message, index) => (
              <div key={index}>
                <span className={styles.eyebrow}>
                  {message.role === "assistant"
                    ? "Expected answer"
                    : message.role}
                </span>
                <pre>{message.content}</pre>
                {message.tool_calls && (
                  <pre>{JSON.stringify(message.tool_calls, null, 2)}</pre>
                )}
                {message.tool_call_id && <code>{message.tool_call_id}</code>}
              </div>
            ))}
          </section>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className="app-button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="app-button" disabled={busy || !datasets.length}>
            {busy
              ? "Preparing…"
              : preview
                ? "Create model"
                : "Review training data"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
