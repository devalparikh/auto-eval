"use client";

import { CheckIcon } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import { Modal } from "@/components/modal";
import { GroundTruthFields } from "@/features/datasets/ground-truth-fields";
import {
  groundTruthFromForm,
  groundTruthFromRecord,
} from "@/features/datasets/ground-truth";
import { api } from "@/lib/api";
import { textPreview } from "@/lib/format";
import type { DatasetItem } from "@/lib/types";

export function EditDatasetItemModal({
  item,
  systemKey,
  onClose,
  onSaved,
}: {
  item: DatasetItem | null;
  systemKey: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    let expected: Record<string, unknown>;
    try {
      expected =
        systemKey === "incident-triage"
          ? groundTruthFromForm(form)
          : (JSON.parse(String(form.get("expectedJson"))) as Record<string, unknown>);
      await api.updateDatasetItem(item.id, {
        expected,
      });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save example");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={Boolean(item)}
      title="Review ground truth"
      description="Update only the draft label fields. The trace input remains unchanged."
      onClose={onClose}
    >
      <form onSubmit={submit} className="grid gap-4 p-5">
        <div className="rounded-[8px] bg-[var(--surface-muted)] p-3 text-[11px] leading-5">
          {item ? textPreview(item.input) : null}
        </div>
        {systemKey === "incident-triage" ? (
          <GroundTruthFields
            initial={groundTruthFromRecord(item?.expected)}
            idPrefix="dataset"
          />
        ) : (
          <div className="field">
            <label htmlFor="dataset-expected-json">Expected output (JSON)</label>
            <textarea
              key={item?.id}
              id="dataset-expected-json"
              name="expectedJson"
              className="app-textarea mono min-h-[180px] text-[10px]"
              defaultValue={JSON.stringify(item?.expected ?? {}, null, 2)}
            />
          </div>
        )}
        {error ? <p className="text-[12px] text-[var(--danger)]">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
          <button type="button" className="app-button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="app-button" disabled={saving}>
            <CheckIcon size={14} />
            {saving ? "Saving..." : "Save labels"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
