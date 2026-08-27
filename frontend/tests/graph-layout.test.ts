import { describe, expect, it } from "vitest";
import { graphLevels } from "@/features/graph/layout";
import { buildTraceGraph } from "@/features/traces/graph-layout";
import type { GraphDefinition, Trace } from "@/lib/types";

const definition: GraphDefinition = {
  entry_point: "start",
  output_node: "finish",
  nodes: [
    { id: "start", label: "Start", kind: "deterministic", handler: "start", task: null },
    { id: "left", label: "Left", kind: "llm", handler: "left", task: "classify" },
    {
      id: "right",
      label: "Right",
      kind: "deterministic",
      handler: "right",
      task: null,
      runtime_input_policy: {
        source: "market_quotes",
        runtime_mode: "refresh",
        evaluation_mode: "locked",
        schema_version: 1,
        required: true,
      },
    },
    { id: "finish", label: "Finish", kind: "llm", handler: "finish", task: "draft" },
  ],
  edges: [
    { source: "start", target: "left" },
    { source: "start", target: "right" },
    { source: "left", target: "finish" },
    { source: "right", target: "finish" },
  ],
};

describe("trace graph layout", () => {
  it("assigns DAG levels using the longest incoming path", () => {
    expect(Object.fromEntries(graphLevels(definition.nodes, definition.edges))).toEqual({
      start: 0,
      left: 1,
      right: 1,
      finish: 2,
    });
  });

  it("keeps nodes at the same level vertically separated and joins span metrics", () => {
    const trace = {
      status: "complete",
      graph_definition: definition,
      spans: [{ node_id: "left", status: "complete", latency_ms: 12, cost_usd: 0.01 }],
    } as Trace;
    const graph = buildTraceGraph(trace, "left");
    expect(graph.nodes.find((node) => node.id === "left")?.position).toEqual({ x: 278, y: 0 });
    expect(graph.nodes.find((node) => node.id === "right")?.position).toEqual({ x: 278, y: 150 });
    expect(graph.nodes.find((node) => node.id === "left")?.initialWidth).toBe(208);
    expect(graph.nodes.find((node) => node.id === "left")?.initialHeight).toBe(118);
    expect(graph.nodes.find((node) => node.id === "left")?.data).toMatchObject({
      latency: 12,
      cost: 0.01,
      selected: true,
    });
  });

  it("gives every node the shared view, its type, and an aria label", () => {
    const trace = {
      status: "complete",
      graph_definition: definition,
      spans: [],
    } as unknown as Trace;
    const graph = buildTraceGraph(trace, null);
    const types = Object.fromEntries(
      graph.nodes.map((node) => [node.id, node.data.view.type]),
    );
    expect(types).toEqual({
      start: "logic",
      left: "model",
      right: "live",
      finish: "model",
    });
    const start = graph.nodes.find((node) => node.id === "start");
    expect(start?.ariaLabel).toBe(start?.data.view.ariaLabel);
    expect(start?.ariaLabel).toContain("Start");
  });

  it("marks the entry and output nodes with badges", () => {
    const trace = {
      status: "complete",
      graph_definition: definition,
      spans: [],
    } as unknown as Trace;
    const graph = buildTraceGraph(trace, null);
    const badges = Object.fromEntries(
      graph.nodes.map((node) => [node.id, node.data.view.badges]),
    );
    expect(badges.start).toEqual(["Start"]);
    expect(badges.finish).toEqual(["Result"]);
    expect(badges.left).toEqual([]);
    expect(badges.right).toEqual([]);
  });
});
