import { describe, expect, it } from "vitest";
import {
  inputForRun,
  inputTemplateForRun,
  modelsForSystem,
  parseRunInput,
} from "@/features/run/run-options";
import type { Catalog } from "@/lib/types";

const catalog = {
  agent_systems: [],
  prompts: [],
  datasets: [],
  models: [
    {
      id: "other",
      provider: "mock",
      label: "Other",
      supports: [],
      available: true,
    },
    {
      id: "default",
      provider: "openrouter",
      label: "Default",
      supports: [],
      available: true,
    },
    {
      id: "offline",
      provider: "openrouter",
      label: "Offline",
      supports: [],
      available: false,
    },
    {
      id: "privacy-blocked",
      provider: "openrouter",
      label: "Privacy blocked",
      supports: ["text"],
      available: true,
      blocked_agent_system_keys: ["portfolio-query"],
    },
  ],
} satisfies Catalog;

describe("run options", () => {
  it("puts available system defaults first without hiding shared models", () => {
    expect(
      modelsForSystem(catalog, ["default", "offline"], "portfolio-query").map(
        (model) => model.id,
      ),
    ).toEqual(["default", "other"]);
  });

  it("accepts object input and rejects other JSON values", () => {
    expect(parseRunInput('{"question":"What changed?"}')).toEqual({
      question: "What changed?",
    });
    expect(() => parseRunInput("[1, 2]")).toThrow("JSON object");
    expect(() => parseRunInput("not-json")).toThrow("valid JSON");
  });

  it("keeps portfolio snapshot documents out of editable query input", () => {
    const template = inputTemplateForRun("portfolio-query", {
      snapshot_id: "snapshot-1",
      snapshot: { positions: [{ shares: 200 }] },
      market_context: { contracts: [{ symbol: "NVDA" }] },
      question: "What changed?",
    });

    expect(template).toEqual({ question: "What changed?" });
    expect(inputForRun("portfolio-query", template, "snapshot-2")).toEqual({
      question: "What changed?",
      snapshot_id: "snapshot-2",
    });

    expect(
      inputForRun(
        "portfolio-query",
        {
          question: "What changed?",
          market_context: { contracts: [{ symbol: "NVDA" }] },
        },
        "snapshot-2",
      ),
    ).toEqual({
      question: "What changed?",
      snapshot_id: "snapshot-2",
    });
  });
});
