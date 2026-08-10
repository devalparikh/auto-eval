import { describe, expect, it } from "vitest";
import {
  availableModels,
  draftDatasetVersions,
  finalDatasetVersions,
  graphVersions,
  promptVersions,
} from "@/features/catalog/catalog-options";
import type { Catalog } from "@/lib/types";

const catalog = {
  agent_systems: [
    {
      id: "system",
      key: "system",
      name: "System",
      description: "",
      versions: [{ id: "graph-2", version: 2, created_at: "2026-01-01" }],
    },
  ],
  prompts: [
    {
      id: "prompt",
      key: "prompt",
      name: "Prompt",
      description: "",
      versions: [{ id: "prompt-3", version: 3, created_at: "2026-01-01" }],
    },
  ],
  datasets: [
    {
      id: "dataset",
      key: "dataset",
      name: "Incidents",
      description: "",
      versions: [
        {
          id: "draft",
          version: 2,
          status: "draft",
          item_count: 1,
          created_at: "2026-01-01",
          finalized_at: null,
        },
        {
          id: "final",
          version: 1,
          status: "final",
          item_count: 6,
          created_at: "2026-01-01",
          finalized_at: "2026-01-01",
        },
      ],
    },
  ],
  models: [
    { id: "ready", provider: "mock", label: "Ready", supports: ["text"], available: true },
    { id: "off", provider: "cli", label: "Off", supports: ["text"], available: false },
  ],
} satisfies Catalog;

describe("catalog option projections", () => {
  it("separates immutable and mutable dataset versions", () => {
    expect(finalDatasetVersions(catalog).map(({ version }) => version.id)).toEqual(["final"]);
    expect(draftDatasetVersions(catalog).map(({ version }) => version.id)).toEqual(["draft"]);
  });

  it("returns only available models and the primary version lists", () => {
    expect(availableModels(catalog).map((model) => model.id)).toEqual(["ready"]);
    expect(graphVersions(catalog)[0]?.id).toBe("graph-2");
    expect(promptVersions(catalog)[0]?.id).toBe("prompt-3");
  });
});
