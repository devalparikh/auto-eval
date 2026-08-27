import { describe, expect, it } from "vitest";
import { graphNodeType, graphNodeView } from "@/features/graph/node-view";
import { buildRunGraphPreview } from "@/features/run/run-graph-preview";
import type { GraphDefinition, GraphNodeDefinition } from "@/lib/types";

const calculation = {
  id: "calculate",
  label: "Calculate",
  kind: "deterministic",
  handler: "calculate",
  task: null,
} satisfies GraphNodeDefinition;

describe("run graph node types", () => {
  it("names every run node with the shared graph vocabulary", () => {
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

    expect(graphNodeType(calculation)).toBe("logic");
    expect(graphNodeType(llmNode)).toBe("model");
    expect(graphNodeType(externalNode)).toBe("live");
    expect(graphNodeType(resourceNode)).toBe("saved");

    const latest = graphNodeView(resourceNode, {
      selection: { mode: "current", identity: "main_portfolio" },
    });
    const exact = graphNodeView(resourceNode, {
      selection: { mode: "locked", snapshot_id: "snapshot-1" },
    });

    expect(latest.type).toBe("saved");
    expect(exact.type).toBe("saved");
    expect(latest.dataFlow.onRun).toBe("Uses the newest saved version.");
    expect(exact.dataFlow.onRun).toBe("Uses one exact saved version.");
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

    const graph = buildRunGraphPreview(definition, {}, "calculate");

    expect(graph.nodes[0]?.position).toEqual({ x: 0, y: 0 });
    expect(graph.nodes[0]?.initialWidth).toBe(204);
    expect(graph.nodes[0]?.initialHeight).toBe(96);
    expect(graph.nodes[1]?.position.x).toBeGreaterThan(0);
    expect(graph.nodes[0]?.data.selected).toBe(true);
    expect(graph.nodes[1]?.data.selected).toBe(false);
    expect(graph.nodes[0]?.data.view.type).toBe("logic");
    expect(graph.nodes[0]?.ariaLabel).toContain("Start");
    expect(graph.nodes[0]?.ariaLabel).toContain("then explain");
    expect(graph.nodes[1]?.data.view.type).toBe("model");
    expect(graph.nodes[1]?.ariaLabel).toContain("Result");
    expect(graph.edges[0]?.type).toBe("smoothstep");
    expect(graph.edges[0]?.style).toMatchObject({ strokeWidth: 1.5 });
  });

  it("keeps long execution paths in one stable left-to-right sequence", () => {
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

    const graph = buildRunGraphPreview(definition, {});

    expect(graph.nodes.map((node) => node.position)).toEqual([
      { x: 0, y: 0 },
      { x: 236, y: 0 },
      { x: 472, y: 0 },
      { x: 708, y: 0 },
      { x: 944, y: 0 },
      { x: 1180, y: 0 },
    ]);
  });
});
