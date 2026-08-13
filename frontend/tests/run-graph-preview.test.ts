import { describe, expect, it } from "vitest";
import {
  buildRunGraphPreview,
  classifyRunNode,
} from "@/features/run/run-graph-preview";
import type { GraphDefinition, GraphNodeDefinition } from "@/lib/types";

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

  it("builds a bounded left-to-right graph with accessible node semantics", () => {
    const definition = {
      entry_point: "calculate",
      output_node: "explain",
      nodes: [
        calculation,
        {
          ...calculation,
          id: "explain",
          label: "Explain",
          kind: "llm",
          handler: "explain",
          prompt_key: "explain-answer",
        },
      ],
      edges: [{ source: "calculate", target: "explain" }],
    } satisfies GraphDefinition;

    const graph = buildRunGraphPreview(definition, {}, false);

    expect(graph.nodes[0]?.position).toEqual({ x: 0, y: 0 });
    expect(graph.nodes[0]?.initialWidth).toBe(204);
    expect(graph.nodes[0]?.initialHeight).toBe(112);
    expect(graph.nodes[1]?.position.x).toBeGreaterThan(0);
    expect(graph.nodes[0]?.ariaLabel).toContain("entry point");
    expect(graph.nodes[0]?.ariaLabel).toContain("continues to explain");
    expect(graph.nodes[1]?.ariaLabel).toContain("LLM");
    expect(graph.nodes[1]?.ariaLabel).toContain("output node");
    expect(graph.edges[0]?.type).toBe("smoothstep");
    expect(graph.edges[0]?.markerEnd).toBeTruthy();
  });

  it("wraps long execution paths into a directional stage grid", () => {
    const nodes = Array.from({ length: 6 }, (_, index) => ({
      ...calculation,
      id: `stage-${index}`,
      label: `Stage ${index}`,
    }));
    const definition = {
      entry_point: "stage-0",
      output_node: "stage-5",
      nodes,
      edges: nodes.slice(1).map((node, index) => ({
        source: `stage-${index}`,
        target: node.id,
      })),
    } satisfies GraphDefinition;

    const graph = buildRunGraphPreview(definition, {}, false, 3);

    expect(graph.nodes.map((node) => node.position)).toEqual([
      { x: 0, y: 0 },
      { x: 252, y: 0 },
      { x: 504, y: 0 },
      { x: 504, y: 160 },
      { x: 252, y: 160 },
      { x: 0, y: 160 },
    ]);
    expect(graph.nodes.slice(0, 3).map((node) => node.data.direction)).toEqual([
      "forward",
      "forward",
      "forward",
    ]);
    expect(graph.nodes.slice(3).map((node) => node.data.direction)).toEqual([
      "reverse",
      "reverse",
      "reverse",
    ]);
  });
});
