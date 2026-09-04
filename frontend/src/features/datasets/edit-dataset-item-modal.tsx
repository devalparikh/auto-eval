"use client";

import { ArrowCounterClockwiseIcon, CheckIcon } from "@phosphor-icons/react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Modal } from "@/components/modal";
import { GroundTruthFields } from "@/features/datasets/ground-truth-fields";
import {
  groundTruthFromForm,
  groundTruthFromRecord,
} from "@/features/datasets/ground-truth";
import { RuntimeSnapshotRefs } from "@/features/systems/runtime-snapshot-refs";
import { SavedInputRefs } from "@/features/systems/saved-input-refs";
import { api } from "@/lib/api";
import type { DatasetItem } from "@/lib/types";

type ParsedExpected =
  { ok: true; value: Record<string, unknown> } | { ok: false; message: string };

function parseExpected(text: string): ParsedExpected {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (caught) {
    // Browsers append a quoted excerpt of the text to the message; the
    // position detail before it is what helps, so drop the excerpt.
    const detail =
      caught instanceof Error
        ? caught.message.replace(/,\s*(?:\.{3}|").*$/s, "").trim()
        : "";
    return {
      ok: false,
      message: detail ? `Not valid JSON: ${detail}.` : "Not valid JSON.",
    };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      message: "Expected output must be a JSON object, not a list or value.",
    };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

function formatInput(input: Record<string, unknown>): string {
  const text = input.text;
  if (typeof text === "string") return text;
  return JSON.stringify(input, null, 2);
}

function expectedText(item: DatasetItem | null): string {
  return JSON.stringify(item?.expected ?? {}, null, 2);
}

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
  // The draft is keyed to the item it belongs to, so opening a different
  // example starts from that example's saved value without an effect.
  const [draft, setDraft] = useState<{ itemId: string; text: string } | null>(
    null,
  );

  const usesGroundTruthForm = systemKey === "incident-triage";
  const savedText = expectedText(item);
  const jsonText =
    draft && item && draft.itemId === item.id ? draft.text : savedText;
  const dirty = jsonText !== savedText;
  const parsed = usesGroundTruthForm ? null : parseExpected(jsonText);
  const jsonError = parsed && !parsed.ok ? parsed.message : null;
  const liveSnapshots = item?.runtime_input_snapshot_ids ?? {};
  const savedSnapshots = item?.node_resource_selections ?? {};

  function close() {
    setError(null);
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item) return;
    let expected: Record<string, unknown>;
    if (usesGroundTruthForm) {
      expected = groundTruthFromForm(new FormData(event.currentTarget));
    } else if (parsed?.ok) {
      expected = parsed.value;
    } else {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.updateDatasetItem(item.id, { expected });
      setDraft(null);
      await onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save example",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={Boolean(item)}
      title="Review expected output"
      description="Edit the expected output. The saved inputs stay as they are."
      onClose={close}
    >
      <form
        onSubmit={submit}
        className="grid min-w-0 gap-5 p-5"
        aria-busy={saving}
      >
        <section className="grid min-w-0 gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="field-label">Input</span>
            <span className="text-[9px] text-[var(--text-faint)]">
              Read only
            </span>
          </div>
          <pre className="mono max-h-44 min-w-0 overflow-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-[10px] leading-5 wrap-anywhere whitespace-pre-wrap text-[var(--text-muted)]">
            {item ? formatInput(item.input) : null}
          </pre>
        </section>

        {Object.keys(liveSnapshots).length ? (
          <SnapshotSection
            title="Live data snapshots"
            hint="Every run reuses these exact snapshots instead of fetching new data."
          >
            <RuntimeSnapshotRefs
              systemKey={systemKey}
              bindings={liveSnapshots}
            />
          </SnapshotSection>
        ) : null}
        {Object.keys(savedSnapshots).length ? (
          <SnapshotSection
            title="Saved data snapshots"
            hint="Every run reads these exact snapshots, so results stay comparable."
          >
            <SavedInputRefs systemKey={systemKey} selections={savedSnapshots} />
          </SnapshotSection>
        ) : null}

        {usesGroundTruthForm ? (
          <GroundTruthFields
            key={item?.id}
            initial={groundTruthFromRecord(item?.expected)}
            idPrefix="dataset"
          />
        ) : (
          <div className="field min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <label className="field-label" htmlFor="dataset-expected-json">
                Expected output (JSON)
              </label>
              {dirty ? (
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
                >
                  <ArrowCounterClockwiseIcon size={11} />
                  Reset
                </button>
              ) : null}
            </div>
            <textarea
              id="dataset-expected-json"
              name="expectedJson"
              className="app-textarea mono min-h-[200px] text-[11px]!"
              value={jsonText}
              spellCheck={false}
              disabled={saving}
              aria-invalid={jsonError ? true : undefined}
              aria-describedby={
                jsonError ? "dataset-expected-json-error" : undefined
              }
              onChange={(event) => {
                if (!item) return;
                setDraft({ itemId: item.id, text: event.target.value });
              }}
            />
            {jsonError ? (
              <p
                id="dataset-expected-json-error"
                role="alert"
                className="text-[10px] leading-4 text-[var(--danger)]"
              >
                {jsonError}
              </p>
            ) : null}
          </div>
        )}

        {error ? (
          <p role="alert" className="text-[12px] text-[var(--danger)]">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
          <button
            type="button"
            className="app-button secondary"
            onClick={close}
          >
            Cancel
          </button>
          <button
            className="app-button"
            disabled={saving || Boolean(jsonError)}
          >
            {saving ? "Saving..." : "Save changes"}
            {!saving ? <CheckIcon size={14} /> : null}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SnapshotSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-[10px] border border-[var(--border)] bg-[var(--surface-muted)] p-3">
      <h3 className="field-label">{title}</h3>
      <p className="mt-1 mb-3 text-[10px] leading-5 text-[var(--text-muted)]">
        {hint}
      </p>
      {children}
    </section>
  );
}
