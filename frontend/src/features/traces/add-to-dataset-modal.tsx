"use client";

import { CheckIcon } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import { Modal } from "@/components/modal";
import { Select } from "@/components/select";
import { draftDatasetVersions } from "@/features/catalog/catalog-options";
import { GroundTruthFields } from "@/features/datasets/ground-truth-fields";
import {
  groundTruthFromForm,
  groundTruthFromRecord,
} from "@/features/datasets/ground-truth";
import { api } from "@/lib/api";
import { textPreview } from "@/lib/format";
import type { Catalog } from "@/lib/types";

export function AddToDatasetModal({
  open,
  traceId,
  traceInput,
  traceOutput,
  catalog,
  onClose,
}: {
  open: boolean;
  traceId: string;
  traceInput: Record<string, unknown>;
  traceOutput: Record<string, unknown>;
  catalog: Catalog | null;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const drafts = draftDatasetVersions(catalog);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      await api.addDatasetItemFromTrace(String(form.get("datasetVersion")), {
        trace_id: traceId,
        input: traceInput,
        expected: groundTruthFromForm(form),
      });
      setSaved(true);
      window.setTimeout(onClose, 700);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not add example",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Review dataset example"
      description="Confirm the ground truth before adding this trace to a draft."
      onClose={onClose}
    >
      <form onSubmit={submit} className="grid gap-4 p-5">
        <div className="field">
          <label htmlFor="dataset-version">Draft dataset</label>
          <Select id="dataset-version" name="datasetVersion" required>
            {drafts.map(({ dataset, version }) => (
              <option key={version.id} value={version.id}>
                {dataset.name} v{version.version}
              </option>
            ))}
          </Select>
        </div>
        <GroundTruthFields
          initial={groundTruthFromRecord(traceOutput)}
          idPrefix="expected"
        />
        <div className="rounded-[8px] bg-[var(--surface-muted)] p-3">
          <p className="text-[10px] font-semibold text-[var(--text-muted)]">
            Request
          </p>
          <p className="mt-1 text-[11px] leading-5">
            {textPreview(traceInput)}
          </p>
        </div>
        {error ? (
          <p className="text-[12px] text-[var(--danger)]">{error}</p>
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
            disabled={saving || saved || drafts.length === 0}
          >
            {saved ? <CheckIcon size={14} /> : null}
            {saved ? "Added" : saving ? "Adding..." : "Add example"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
