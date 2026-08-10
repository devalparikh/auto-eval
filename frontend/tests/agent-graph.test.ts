import { describe, expect, it } from "vitest";
import {
  buildAgentGraph,
  isGraphDefinition,
} from "@/features/systems/agent-graph";
import type { GraphDefinition } from "@/lib/types";

const definition = {
  entry_point: "prepare",
  output_node: "answer",
  nodes: [
    {
      id: "prepare",
      label: "Prepare",
      kind: "deterministic",
      handler: "prepare",
      task: null,
    },
    {
      id: "answer",
      label: "Answer",
      kind: "llm",
      handler: "answer",
      task: "answer",
      prompt_key: "answer-prompt",
    },
  ],
  edges: [{ source: "prepare", target: "answer" }],
} satisfies GraphDefinition;

describe("agent graph", () => {
  it("lays out nodes and exposes entry, output, and prompt associations", () => {
    const graph = buildAgentGraph(definition);
    expect(graph.nodes[0]?.position.x).toBe(0);
    expect(graph.nodes[1]?.position.x).toBeGreaterThan(0);
    expect(graph.nodes[0]?.ariaLabel).toContain("entry point");
    expect(graph.nodes[1]?.ariaLabel).toContain("prompt answer-prompt");
    expect(graph.nodes[1]?.ariaLabel).toContain("output node");
    expect(graph.edges).toHaveLength(1);
  });

  it("rejects arbitrary JSON as a graph definition", () => {
    expect(isGraphDefinition({ nodes: [] })).toBe(false);
    expect(isGraphDefinition(definition)).toBe(true);
  });
});
