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
          Latest uses the newest saved output for an identity when the run
          starts. Exact version replays one immutable saved output. Saved
          content stays separate from the business request.
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
            Input key: {policy.resource_key}; schema: v{policy.schema_version}
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
            <option value="">No compatible saved inputs</option>
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
          {selected?.description ??
            "No compatible saved output exists for this node."}
        </p>
        {selected?.snapshot ? (
          <p className="mono text-[8px] text-[var(--text-faint)]">
            {selected.snapshot.is_synthetic ? "synthetic" : "real"} ·{" "}
            {shortId(selected.snapshot.id)} ·{" "}
            {selected.snapshot.content_hash.slice(0, 10)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
