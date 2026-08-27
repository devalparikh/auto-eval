"use client";

import { Select } from "@/components/select";
import { GraphNodePromptPanel } from "@/features/graph/node-prompt-panel";
import type { GraphNodeView } from "@/features/graph/node-view";
import type { SavedInputChoice } from "@/features/run/run-saved-input-options";
import { formatDate, shortId } from "@/lib/format";
import type { PromptSummary, RuntimeInputSnapshotSummary } from "@/lib/types";

/**
 * The parts of a run a reader can change from the node they belong to: the
 * prompt a model node sends, and the saved data a pinned input node reads.
 */
export function RunNodeControls({
  view,
  systemKey,
  prompt,
  promptVersionId,
  onSelectPromptVersion,
  savedInputChoices,
  savedInputToken,
  savedInputLoading,
  onSelectSavedInput,
  liveInputSnapshots,
  liveInputSnapshotId,
  liveInputLoading,
  onSelectLiveInput,
  captureNodeOutputs,
  submitting,
}: {
  view: GraphNodeView;
  systemKey: string;
  prompt: PromptSummary | undefined;
  promptVersionId: string;
  onSelectPromptVersion: (promptKey: string, versionId: string) => void;
  savedInputChoices: SavedInputChoice[];
  savedInputToken: string;
  savedInputLoading: boolean;
  onSelectSavedInput: (nodeId: string, token: string) => void;
  liveInputSnapshots: RuntimeInputSnapshotSummary[];
  liveInputSnapshotId: string;
  liveInputLoading: boolean;
  onSelectLiveInput: (nodeId: string, snapshotId: string) => void;
  captureNodeOutputs: boolean;
  submitting: boolean;
}) {
  const node = view.definition;
  const promptKey = view.promptKey;
  const resourcePolicy = node.resource_policy;
  const runtimePolicy = node.runtime_input_policy;
  const snapshotPolicy = node.snapshot_policy;
  const replaysSavedCopy = runtimePolicy?.runtime_mode === "locked";
  const keepsOptionalCopy = Boolean(
    snapshotPolicy &&
      snapshotPolicy.binding_mode !== "consume" &&
      !snapshotPolicy.required,
  );

  return (
    <>
      {promptKey ? (
        <div className="border-b border-[var(--border)] last:border-b-0">
          <GraphNodePromptPanel
            systemKey={systemKey}
            promptKey={promptKey}
            prompt={prompt}
            selectedVersionId={promptVersionId}
            disabled={submitting}
            onSelectVersion={(versionId) =>
              onSelectPromptVersion(promptKey, versionId)
            }
          />
        </div>
      ) : null}

      {resourcePolicy ? (
        <div className="border-b border-[var(--border)] px-4 py-3 last:border-b-0">
          {savedInputLoading ? (
            <p className="text-[10px] text-[var(--text-muted)]">
              Loading saved versions…
            </p>
          ) : (
            <SavedInputField
              nodeId={node.id}
              required={resourcePolicy.required}
              choices={savedInputChoices}
              selectedToken={savedInputToken}
              submitting={submitting}
              onSelect={onSelectSavedInput}
            />
          )}
        </div>
      ) : null}

      {replaysSavedCopy && runtimePolicy ? (
        <div className="border-b border-[var(--border)] px-4 py-3 last:border-b-0">
          {liveInputLoading ? (
            <p className="text-[10px] text-[var(--text-muted)]">
              Loading saved copies…
            </p>
          ) : (
            <LiveInputField
              nodeId={node.id}
              source={runtimePolicy.source}
              required={runtimePolicy.required}
              snapshots={liveInputSnapshots}
              selectedId={liveInputSnapshotId}
              submitting={submitting}
              onSelect={onSelectLiveInput}
            />
          )}
        </div>
      ) : null}

      {keepsOptionalCopy ? (
        <p className="px-4 py-3 text-[10px] leading-5 text-[var(--text-muted)]">
          {captureNodeOutputs
            ? "This run keeps a copy of this node's output."
            : "This run does not keep a copy of this node's output."}
        </p>
      ) : null}
    </>
  );
}

function SavedInputField({
  nodeId,
  required,
  choices,
  selectedToken,
  submitting,
  onSelect,
}: {
  nodeId: string;
  required: boolean;
  choices: SavedInputChoice[];
  selectedToken: string;
  submitting: boolean;
  onSelect: (nodeId: string, token: string) => void;
}) {
  const selected = choices.find((choice) => choice.token === selectedToken);
  const latestChoices = choices.filter(
    (choice) => choice.selection.mode === "current",
  );
  const exactChoices = choices.filter(
    (choice) => choice.selection.mode === "locked",
  );

  return (
    <div className="field">
      <label htmlFor={`run-resource-${nodeId}`}>Saved input version</label>
      <Select
        id={`run-resource-${nodeId}`}
        value={selectedToken}
        disabled={submitting || choices.length === 0}
        required={required}
        onChange={(event) => onSelect(nodeId, event.target.value)}
      >
        {choices.length === 0 ? (
          <option value="">Nothing saved yet</option>
        ) : null}
        {latestChoices.length ? (
          <optgroup label="Latest saved output">
            {latestChoices.map((choice) => (
              <option key={choice.token} value={choice.token}>
                {choice.label}
              </option>
            ))}
          </optgroup>
        ) : null}
        {exactChoices.length ? (
          <optgroup label="Exact saved version">
            {exactChoices.map((choice) => (
              <option key={choice.token} value={choice.token}>
                {choice.label}
              </option>
            ))}
          </optgroup>
        ) : null}
      </Select>
      <p className="text-[9px] leading-4 text-[var(--text-muted)]">
        {selected?.description ?? "Nothing has been saved for this node yet."}
      </p>
      {selected?.snapshot ? (
        <p className="mono flex flex-wrap gap-x-2 text-[8px] text-[var(--text-faint)]">
          <span>
            {selected.snapshot.is_synthetic ? "Example data" : "Real data"}
          </span>
          <span>{shortId(selected.snapshot.id)}</span>
        </p>
      ) : null}
    </div>
  );
}

function LiveInputField({
  nodeId,
  source,
  required,
  snapshots,
  selectedId,
  submitting,
  onSelect,
}: {
  nodeId: string;
  source: string;
  required: boolean;
  snapshots: RuntimeInputSnapshotSummary[];
  selectedId: string;
  submitting: boolean;
  onSelect: (nodeId: string, snapshotId: string) => void;
}) {
  const selected = snapshots.find((snapshot) => snapshot.id === selectedId);

  return (
    <div className="field">
      <label htmlFor={`run-live-input-${nodeId}`}>Saved copy to use</label>
      <Select
        id={`run-live-input-${nodeId}`}
        value={selectedId}
        disabled={submitting || snapshots.length === 0}
        required={required}
        onChange={(event) => onSelect(nodeId, event.target.value)}
      >
        {snapshots.length === 0 ? (
          <option value="">Nothing saved yet</option>
        ) : null}
        {snapshots.map((snapshot) => (
          <option key={snapshot.id} value={snapshot.id}>
            {snapshot.label} — {formatDate(snapshot.observed_at)}
          </option>
        ))}
      </Select>
      {selected ? (
        <>
          <p className="text-[9px] leading-4 text-[var(--text-muted)]">
            This run reads this copy instead of fetching new {readable(source)}{" "}
            data.
          </p>
          <p className="mono flex flex-wrap gap-x-2 text-[8px] text-[var(--text-faint)]">
            <span>{selected.is_synthetic ? "Example data" : "Real data"}</span>
            <span>{selected.provider}</span>
            <span>{shortId(selected.id)}</span>
          </p>
        </>
      ) : (
        <p className="text-[9px] leading-4 text-[var(--warning)]">
          Nothing has been saved for this node yet, so this run has no{" "}
          {readable(source)} data to read.
        </p>
      )}
    </div>
  );
}

function readable(key: string): string {
  return key.replaceAll("_", " ");
}
