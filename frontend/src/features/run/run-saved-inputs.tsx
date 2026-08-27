import { DatabaseIcon } from "@phosphor-icons/react";
import { Select } from "@/components/select";
import { LoadingState } from "@/components/states";
import type { SavedInputChoice } from "@/features/run/run-saved-input-options";
import { shortId } from "@/lib/format";
import type { GraphNodeDefinition } from "@/lib/types";

export function RunSavedInputs({
  nodes,
  choices,
  selectedTokens,
  loading,
  submitting,
  onSelect,
}: {
  nodes: GraphNodeDefinition[];
  choices: Record<string, SavedInputChoice[]>;
  selectedTokens: Record<string, string>;
  loading: boolean;
  submitting: boolean;
  onSelect: (nodeId: string, token: string) => void;
}) {
  if (!nodes.length) return null;
  return (
    <section
      className="border-t border-[var(--border)] pt-5"
      aria-labelledby="run-saved-inputs-title"
    >
      <div className="mb-3">
        <h3 id="run-saved-inputs-title" className="text-[11px] font-semibold">
          Saved inputs
        </h3>
        <p className="mt-1 text-[10px] leading-5 text-[var(--text-muted)]">
          Pick which saved output this run reads. Latest picks the newest one
          when the run starts; an exact version replays that one every time.
        </p>
      </div>
      {loading ? (
        <LoadingState rows={2} />
      ) : (
        <div className="grid gap-3">
          {nodes.map((node) => (
            <SavedInputField
              key={node.id}
              node={node}
              choices={choices[node.id] ?? []}
              selectedToken={selectedTokens[node.id] ?? ""}
              submitting={submitting}
              onSelect={(token) => onSelect(node.id, token)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SavedInputField({
  node,
  choices,
  selectedToken,
  submitting,
  onSelect,
}: {
  node: GraphNodeDefinition;
  choices: SavedInputChoice[];
  selectedToken: string;
  submitting: boolean;
  onSelect: (token: string) => void;
}) {
  const policy = node.resource_policy;
  const selected = choices.find((choice) => choice.token === selectedToken);
  if (!policy) return null;
  const latestChoices = choices.filter(
    (choice) => choice.selection.mode === "current",
  );
  const exactChoices = choices.filter(
    (choice) => choice.selection.mode === "locked",
  );
  return (
    <div className="grid gap-3 border border-[var(--border)] p-3 md:grid-cols-[minmax(200px,0.38fr)_minmax(0,1fr)]">
      <div className="flex items-start gap-2">
        <DatabaseIcon
          size={14}
          className="mt-0.5 shrink-0 text-[var(--accent)]"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold">{node.label}</p>
          <p className="mono mt-1 break-all text-[8px] leading-4 text-[var(--text-faint)]">
            Node: {node.id}
            <br />
            Reads: {policy.resource_key}
          </p>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`run-resource-${node.id}`}>Saved input version</label>
        <Select
          id={`run-resource-${node.id}`}
          value={selectedToken}
          disabled={submitting || choices.length === 0}
          required={policy.required}
          onChange={(event) => onSelect(event.target.value)}
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
    </div>
  );
}
