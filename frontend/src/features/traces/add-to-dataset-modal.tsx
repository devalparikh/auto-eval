"use client";

import { CheckIcon, WarningIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Modal } from "@/components/modal";
import { Select } from "@/components/select";
import { ErrorState, LoadingState } from "@/components/states";
import { GroundTruthFields } from "@/features/datasets/ground-truth-fields";
import {
  groundTruthFromForm,
  groundTruthFromRecord,
} from "@/features/datasets/ground-truth";
import { systemPath } from "@/features/systems/system-path";
import { api } from "@/lib/api";
import { textPreview } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";

export function AddToDatasetModal({
  open,
  traceId,
  traceInput,
  traceOutput,
  systemKey,
  onClose,
  onMembershipChanged,
}: {
  open: boolean;
  traceId: string;
  traceInput: Record<string, unknown>;
  traceOutput: Record<string, unknown>;
  systemKey: string;
  onClose: () => void;
  onMembershipChanged: () => Promise<void>;
}) {
  const targets = useApiResource(
    () => (open ? api.traceDatasetTargets(traceId) : Promise.resolve(null)),
    [open, traceId],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedVersionId, setSavedVersionId] = useState<string | null>(null);
  const eligibleTargets = targets.data?.targets.filter((target) => target.eligible) ?? [];
  const expectedSuggestion = targets.data?.evaluation_expected ?? traceOutput;

  function close() {
    setError(null);
    setSavedVersionId(null);
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const versionId = String(form.get("datasetVersion"));
    let expected: Record<string, unknown>;
    try {
      expected =
        systemKey === "incident-triage"
          ? groundTruthFromForm(form)
          : (JSON.parse(String(form.get("expectedJson"))) as Record<string, unknown>);
    } catch {
      setError("Expected output must be a valid JSON object.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.addDatasetItemFromTrace(versionId, traceId, { expected });
      setSavedVersionId(versionId);
      await Promise.all([targets.reload(), onMembershipChanged()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add example");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Review dataset example"
      description="Choose a compatible draft and confirm ground truth before promotion."
      onClose={close}
    >
      {targets.loading ? <LoadingState rows={5} /> : null}
      {targets.error ? <ErrorState message={targets.error} retry={targets.reload} /> : null}
      {!targets.loading && !targets.error ? (
        <form onSubmit={submit} className="grid gap-4 p-5" aria-busy={saving}>
          {targets.data?.memberships.length ? (
            <div className="rounded-[2px] border border-[var(--border)] bg-[var(--surface-muted)] p-3">
              <p className="text-[10px] font-semibold text-[var(--text-muted)]">
                Already used as a source
              </p>
              <ul className="mt-2 grid gap-1 text-[10px]">
                {targets.data.memberships.map((membership) => (
                  <li key={membership.dataset_item_id}>
                    {membership.dataset_name} v{membership.dataset_version} ·{" "}
                    {membership.dataset_version_status}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {targets.data?.evaluation_expected ? (
            <div className="flex gap-2 rounded-[2px] border border-[var(--warning)] bg-[var(--warning-soft)] p-3 text-[10px] leading-5">
              <WarningIcon size={14} className="mt-0.5 shrink-0" />
              This evaluation trace is prefilled from the original reviewed expected value,
              never from the model&apos;s actual output.
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="dataset-version">Draft dataset</label>
            <Select
              id="dataset-version"
              name="datasetVersion"
              required
              disabled={eligibleTargets.length === 0}
            >
              {targets.data?.targets.map((target) => (
                <option
                  key={target.dataset_version_id}
                  value={target.dataset_version_id}
                  disabled={!target.eligible}
                >
                  {target.dataset_name} v{target.dataset_version}
                  {target.reason === "already_in_version" ? " · Already included" : ""}
                </option>
              ))}
            </Select>
          </div>
          {systemKey === "incident-triage" ? (
            <GroundTruthFields
              key={JSON.stringify(expectedSuggestion)}
              initial={groundTruthFromRecord(expectedSuggestion)}
              idPrefix="expected"
            />
          ) : (
            <div className="field">
              <label htmlFor="expected-json">Expected output (JSON)</label>
              <textarea
                key={JSON.stringify(expectedSuggestion)}
                id="expected-json"
                name="expectedJson"
                className="app-textarea mono min-h-[180px] text-[10px]"
                defaultValue={JSON.stringify(expectedSuggestion, null, 2)}
              />
            </div>
          )}
          <div className="rounded-[2px] bg-[var(--surface-muted)] p-3">
            <p className="text-[10px] font-semibold text-[var(--text-muted)]">Request</p>
            <p className="mt-1 text-[11px] leading-5">{textPreview(traceInput)}</p>
          </div>
          {!targets.data?.targets.length ? (
            <p className="text-[11px] leading-5 text-[var(--text-muted)]">
              No compatible draft exists. Create one from the{" "}
              <Link className="underline" href={systemPath(systemKey, "datasets")}>
                dataset workspace
              </Link>
              .
            </p>
          ) : eligibleTargets.length === 0 ? (
            <p className="text-[11px] text-[var(--text-muted)]">
              This trace is already included in every compatible draft.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-[12px] text-[var(--danger)]">
              {error}
            </p>
          ) : null}
          {savedVersionId ? (
            <p role="status" aria-live="polite" className="text-[11px] text-[var(--success)]">
              Example added. Membership is now persisted on this trace.
            </p>
          ) : null}
          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            {savedVersionId ? (
              <Link className="app-button secondary" href={systemPath(systemKey, "datasets")}>
                View dataset
              </Link>
            ) : null}
            <button type="button" className="app-button secondary" onClick={close}>
              {savedVersionId ? "Done" : "Cancel"}
            </button>
            {!savedVersionId ? (
              <button className="app-button" disabled={saving || eligibleTargets.length === 0}>
                {saving ? "Adding..." : "Add example"}
                {!saving ? <CheckIcon size={14} /> : null}
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
