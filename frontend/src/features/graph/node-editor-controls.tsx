"use client";

import { editableNodeFields, type NodeEdit } from "@/features/graph/node-edit";
import type { GraphNodeDefinition } from "@/lib/types";

/**
 * The settings a reader can change on the selected node, shown inside that
 * node's details panel while the graph is being edited.
 *
 * Renders nothing for a node with no settings, so a caller can hand it every
 * selection without asking first.
 */
export function GraphNodeEditorControls({
  node,
  onEdit,
}: {
  node: GraphNodeDefinition;
  onEdit: (edit: NodeEdit) => void;
}) {
  const fields = editableNodeFields(node);
  if (fields.length === 0) return null;

  return (
    <div className="grid gap-4 px-4 py-3">
      {fields.map((field) => (
        <fieldset key={field.key} className="min-w-0">
          <legend className="text-[10px] font-medium">{field.label}</legend>
          <p className="mt-1 text-[10px] leading-5 text-[var(--text-muted)]">
            {field.description}
          </p>
          <div className="mt-2 grid gap-1.5">
            {field.choices.map((choice) => {
              const checked = field.value === choice.value;
              return (
                <label
                  key={choice.value}
                  className={`flex min-w-0 cursor-pointer items-start gap-2.5 border px-3 py-2.5 ${
                    checked
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                      : "border-[var(--border)] hover:bg-[var(--surface-muted)]"
                  }`}
                >
                  <input
                    type="radio"
                    className="mt-0.5 shrink-0 accent-[var(--accent)]"
                    name={`${field.nodeId}:${field.key}`}
                    value={choice.value}
                    checked={checked}
                    onChange={() =>
                      onEdit({
                        nodeId: field.nodeId,
                        field: field.key,
                        value: choice.value,
                      })
                    }
                  />
                  <span className="min-w-0">
                    <span className="block text-[10px] font-medium">
                      {choice.label}
                    </span>
                    <span className="mt-0.5 block text-[9px] leading-4 text-[var(--text-muted)]">
                      {choice.hint}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
