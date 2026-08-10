"use client";

import { CheckIcon } from "@phosphor-icons/react";
import type { ModelOption } from "@/lib/types";

export function ModelPicker({
  models,
  selectedModelIds,
  onChange,
}: {
  models: ModelOption[];
  selectedModelIds: string[];
  onChange: (modelIds: string[]) => void;
}) {
  function toggle(modelId: string) {
    onChange(
      selectedModelIds.includes(modelId)
        ? selectedModelIds.filter((id) => id !== modelId)
        : [...selectedModelIds, modelId],
    );
  }

  return (
    <fieldset>
      <legend className="field-label mb-2">Models</legend>
      <div className="grid gap-2 md:grid-cols-2">
        {models.map((model) => {
          const checked = selectedModelIds.includes(model.id);
          return (
            <label
              key={model.id}
              className={`flex cursor-pointer items-center gap-3 rounded-[9px] border p-3 transition-colors ${
                checked
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--border-strong)]"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() => toggle(model.id)}
              />
              <span
                className={`grid size-5 place-items-center rounded-[5px] border ${
                  checked
                    ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                    : "border-[var(--border-strong)]"
                }`}
              >
                {checked ? <CheckIcon size={12} weight="bold" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-semibold">
                  {model.label}
                </span>
                <span className="mt-0.5 block text-[10px] text-[var(--text-muted)]">
                  {model.provider} · {model.supports.join(", ")}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
