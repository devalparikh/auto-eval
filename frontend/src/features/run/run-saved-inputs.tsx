import { Select } from "@/components/select";
import { LoadingState } from "@/components/states";
import type { SavedInputChoice } from "@/features/run/run-saved-input-options";
import type { GraphNodeDefinition } from "@/lib/types";

export function RunSavedInputs({
  node,
  choices,
  selectedToken,
  loading,
  submitting,
  onSelect,
}: {
  node: GraphNodeDefinition;
  choices: SavedInputChoice[];
  selectedToken: string;
  loading: boolean;
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
    <section className="px-4 py-3" aria-label="Saved input selection">
      {loading ? (
        <LoadingState rows={1} />
      ) : (
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
          <p className="text-[10px] leading-5 text-[var(--text-muted)]">
            Latest resolves when the run starts. Exact replays the chosen
            version.
          </p>
          <p className="text-[9px] leading-4 text-[var(--text-faint)]">
            {selected?.description ??
              "Nothing has been saved for this node yet."}
          </p>
        </div>
      )}
    </section>
  );
}
