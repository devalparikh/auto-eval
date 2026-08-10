"use client";

import { PlusIcon } from "@phosphor-icons/react";
import type { FormEvent } from "react";
import { Modal } from "@/components/modal";
import { LoadingState } from "@/components/states";
import {
  availableModels,
  graphVersions,
  promptVersions,
} from "@/features/catalog/catalog-options";
import type { Catalog } from "@/lib/types";

export type RunTraceInput = {
  text: string;
  service: string;
  modelId: string;
  graphVersionId: string;
  promptVersionId: string;
};

export function RunTraceModal({
  open,
  catalog,
  loading,
  submitting,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  catalog: Catalog | null;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: RunTraceInput) => Promise<void>;
}) {
  const models = availableModels(catalog);
  const graphs = graphVersions(catalog);
  const prompts = promptVersions(catalog);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onSubmit({
      text: String(form.get("text")),
      service: String(form.get("service")),
      modelId: String(form.get("model")),
      graphVersionId: String(form.get("graphVersion")),
      promptVersionId: String(form.get("promptVersion")),
    });
  }

  return (
    <Modal
      open={open}
      title="Run an agent request"
      description="The latest graph and prompt versions are selected by default."
      onClose={onClose}
    >
      {loading ? (
        <LoadingState rows={5} />
      ) : (
        <form onSubmit={submit} className="grid gap-4 p-5">
          <div className="field">
            <label htmlFor="trace-text">Incident report</label>
            <textarea
              id="trace-text"
              name="text"
              className="app-textarea"
              required
              defaultValue="The checkout service is returning 5xx errors for enterprise customers."
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="trace-service">Service</label>
              <input
                id="trace-service"
                name="service"
                className="app-input"
                defaultValue="checkout"
              />
            </div>
            <div className="field">
              <label htmlFor="trace-model">Model</label>
              <select id="trace-model" name="model" className="app-select">
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="trace-graph">Agent system</label>
              <select id="trace-graph" name="graphVersion" className="app-select">
                {graphs.map((version) => (
                  <option key={version.id} value={version.id}>
                    Incident triage v{version.version}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="trace-prompt">System prompt</label>
              <select id="trace-prompt" name="promptVersion" className="app-select">
                {prompts.map((version) => (
                  <option key={version.id} value={version.id}>
                    Triage prompt v{version.version}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {error ? <p className="text-[12px] text-[var(--danger)]">{error}</p> : null}
          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <button type="button" className="app-button secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="app-button"
              disabled={submitting || graphs.length === 0 || prompts.length === 0}
            >
              {submitting ? "Running..." : "Run trace"}
              {!submitting ? <PlusIcon size={14} /> : null}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
