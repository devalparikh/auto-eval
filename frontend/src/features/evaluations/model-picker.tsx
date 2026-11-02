"use client";

import { MultiSelect } from "@/components/select";
import { modelChoices } from "@/features/catalog/catalog-options";
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
  const notices = models.filter(
    (model) => model.notice && selectedModelIds.includes(model.id),
  );
  return (
    <div className="field">
      <span>Models</span>
      <MultiSelect
        label="Models"
        options={modelChoices(models)}
        selected={selectedModelIds}
        onChange={onChange}
        placeholder="Select models"
      />
      {notices.map((model) => (
        <p key={model.id} className="text-[10px] leading-4 text-[var(--warning)]">
          {model.label}: {model.notice}
        </p>
      ))}
    </div>
  );
}
