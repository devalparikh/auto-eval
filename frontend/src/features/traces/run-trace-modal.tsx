"use client";

import { PlusIcon } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import { Modal } from "@/components/modal";
import { Select } from "@/components/select";
import { LoadingState } from "@/components/states";
import {
  availableModels,
  graphVersions,
  promptVersions,
  systemByKey,
} from "@/features/catalog/catalog-options";
import type { Catalog } from "@/lib/types";

export type RunTraceInput = {
  input: Record<string, unknown>;
  modelId: string;
  graphVersionId: string;
  promptVersionId: string;
};

export function RunTraceModal({
  open,
  catalog,
  systemKey,
  loading,
  submitting,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  catalog: Catalog | null;
  systemKey: string;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: RunTraceInput) => Promise<void>;
}) {
  const [parseError, setParseError] = useState<string | null>(null);
  const system = systemByKey(catalog, systemKey);
  const allModels = availableModels(catalog);
  const models = [
    ...allModels.filter((model) => system?.default_model_ids.includes(model.id)),
    ...allModels.filter((model) => !system?.default_model_ids.includes(model.id)),
  ];
  const graphs = graphVersions(catalog, systemKey);
  const prompts = promptVersions(catalog, systemKey);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setParseError(null);
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(String(form.get("input"))) as Record<string, unknown>;
    } catch {
      setParseError("Request input must be a valid JSON object.");
      return;
    }
    await onSubmit({
      input,
      modelId: String(form.get("model")),
      graphVersionId: String(form.get("graphVersion")),
      promptVersionId: String(form.get("promptVersion")),
    });
  }

  return (
    <Modal
      open={open}
      title="Run an agent request"
      description={`Run ${system?.name ?? "this system"} with pinned graph and prompt versions.`}
      onClose={onClose}
    >
      {loading ? (
        <LoadingState rows={5} />
      ) : (
        <form onSubmit={submit} className="grid gap-4 p-5">
          <div className="field">
            <label htmlFor="trace-input">Request input (JSON)</label>
            <textarea
              key={system?.id}
              id="trace-input"
              name="input"
              className="app-textarea mono min-h-[240px] text-[10px]"
              required
              defaultValue={JSON.stringify(system?.input_template ?? {}, null, 2)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="trace-model">Model</label>
              <Select id="trace-model" name="model">
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="trace-graph">Agent system</label>
              <Select id="trace-graph" name="graphVersion">
                {graphs.map((version) => (
                  <option key={version.id} value={version.id}>
                    {system?.name} v{version.version}
                  </option>
                ))}
              </Select>
            </div>
            <div className="field">
              <label htmlFor="trace-prompt">System prompt</label>
              <Select id="trace-prompt" name="promptVersion">
                {prompts.map((version) => (
                  <option key={version.id} value={version.id}>
                    Prompt v{version.version}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {error || parseError ? (
            <p className="text-[12px] text-[var(--danger)]">{error ?? parseError}</p>
          ) : null}
          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <button
              type="button"
              className="app-button secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="app-button"
              disabled={
                submitting || graphs.length === 0 || prompts.length === 0
              }
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
