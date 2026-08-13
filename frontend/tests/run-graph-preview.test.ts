import { describe, expect, it } from "vitest";
import { classifyRunNode } from "@/features/run/run-graph-preview";
import type { GraphNodeDefinition } from "@/lib/types";

const calculation = {
  id: "calculate",
  label: "Calculate",
  kind: "deterministic",
  handler: "calculate",
  task: null,
} satisfies GraphNodeDefinition;

describe("run graph classifications", () => {
  it("distinguishes calculations, current resources, live external data, replay, and LLM work", () => {
    const resourceNode = {
      ...calculation,
      id: "get_indexed_portfolio",
      resource_policy: {
        product_key: "portfolio-analyst",
        resource_key: "indexed_portfolio",
        producer_system_key: "portfolio-analyst",
        producer_node_id: "persist_portfolio_snapshot",
        producer_output_key: "portfolio_state",
        producer_snapshot_kind: "state",
        schema_version: 1,
        runtime_mode: "current",
        evaluation_mode: "locked",
        required: true,
      },
    } satisfies GraphNodeDefinition;
    const externalNode = {
      ...calculation,
      id: "load_options",
      runtime_input_policy: {
        source: "options_chain",
        schema_version: 1,
        required: false,
        runtime_mode: "refresh",
        evaluation_mode: "locked",
      },
    } satisfies GraphNodeDefinition;
    const llmNode = {
      ...calculation,
      id: "explain",
      kind: "llm",
      prompt_key: "explain-answer",
    } satisfies GraphNodeDefinition;

    expect(classifyRunNode(calculation)).toBe("deterministic calculation");
    expect(
      classifyRunNode(resourceNode, {
        mode: "current",
        identity: "main_portfolio",
      }),
    ).toBe("deterministic current resource");
    expect(classifyRunNode(externalNode)).toBe("deterministic live external");
    expect(
      classifyRunNode(resourceNode, {
        mode: "locked",
        snapshot_id: "snapshot-1",
      }),
    ).toBe("snapshot replay");
    expect(classifyRunNode(llmNode)).toBe("LLM");
  });
});
