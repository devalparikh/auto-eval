import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentGraph,
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
      label: "Fetch options chain",
      kind: "deterministic",
      handler: "prepare",
      task: null,
      runtime_input_policy: {
        source: "options_chain",
        runtime_mode: "refresh",
        evaluation_mode: "locked",
        schema_version: 1,
        required: false,
      },
      snapshot_policy: {
        output_key: "options_chain",
        snapshot_kind: "external_observation",
        schema_version: 1,
        binding_mode: "produce_or_consume",
        reveal_policy_key: "external_observation",
        required: false,
      },
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
  afterEach(cleanup);

  it("lays out nodes and classifies live and model nodes", () => {
    const graph = buildAgentGraph(definition);
    expect(graph.nodes[0]?.position.x).toBe(0);
    expect(graph.nodes[0]?.initialWidth).toBe(216);
    expect(graph.nodes[0]?.initialHeight).toBe(100);
    expect(graph.nodes[1]?.position.x).toBeGreaterThan(0);
    expect(graph.edges).toHaveLength(1);

    expect(graph.nodes[0]?.data.view.type).toBe("live");
    expect(graph.nodes[0]?.data.view.badges).toEqual([
      "Start",
      "Saves output",
      "Optional",
    ]);
    expect(graph.nodes[0]?.ariaLabel).toContain("Fetch options chain");
    expect(graph.nodes[0]?.ariaLabel).toContain("Live data");
    expect(graph.nodes[0]?.ariaLabel).toContain("Start");
    expect(graph.nodes[0]?.ariaLabel).toContain("Optional");
    expect(graph.nodes[0]?.ariaLabel).toContain("source options_chain");

    expect(graph.nodes[1]?.data.view.type).toBe("model");
    expect(graph.nodes[1]?.data.view.badges).toEqual(["Result"]);
    expect(graph.nodes[1]?.ariaLabel).toContain("Model");
    expect(graph.nodes[1]?.ariaLabel).toContain("prompt answer-prompt");
  });

  it("keeps backend-only snapshot vocabulary out of the node labels", () => {
    const graph = buildAgentGraph(definition);
    for (const node of graph.nodes) {
      expect(node.ariaLabel).not.toContain("produce_or_consume");
      expect(node.ariaLabel).not.toContain("external_observation");
      expect(node.ariaLabel).not.toContain("·");
      expect(node.data.view.badges.join(" ")).not.toContain("·");
    }
  });

  it("marks the selected node", () => {
    const graph = buildAgentGraph(definition, "answer");
    expect(graph.nodes[0]?.data.selected).toBe(false);
    expect(graph.nodes[1]?.data.selected).toBe(true);
  });

  it("rejects arbitrary JSON as a graph definition", () => {
    expect(isGraphDefinition({ nodes: [] })).toBe(false);
    expect(isGraphDefinition(definition)).toBe(true);
  });

  it("classifies a node reading a saved resource as saved data", () => {
    const resourceDefinition = {
      ...definition,
      entry_point: "resource",
      nodes: [
        {
          id: "resource",
          label: "Get indexed portfolio",
          kind: "deterministic" as const,
          handler: "get_indexed_portfolio",
          task: null,
          resource_policy: {
            product_key: "portfolio-analyst",
            resource_key: "indexed_portfolio",
            producer_system_key: "portfolio-analyst",
            producer_node_id: "persist_portfolio_snapshot",
            producer_output_key: "portfolio_state",
            producer_snapshot_kind: "state" as const,
            schema_version: 1,
            runtime_mode: "current" as const,
            evaluation_mode: "locked" as const,
            required: true,
          },
        },
        definition.nodes[1],
      ],
      edges: [{ source: "resource", target: "answer" }],
    } satisfies GraphDefinition;

    const graph = buildAgentGraph(resourceDefinition);
    expect(graph.nodes[0]?.data.view.type).toBe("saved");
    expect(graph.nodes[0]?.data.view.badges).toEqual(["Start"]);
    expect(graph.nodes[0]?.ariaLabel).toContain("Saved data");
    expect(graph.nodes[0]?.ariaLabel).toContain("reads indexed_portfolio");
    expect(graph.nodes[0]?.ariaLabel).toContain(
      "saved by portfolio-analyst / persist_portfolio_snapshot",
    );
  });

  it("classifies a plain deterministic node as logic", () => {
    const logicDefinition = {
      entry_point: "score",
      output_node: "score",
      nodes: [
        {
          id: "score",
          label: "Score answer",
          kind: "deterministic" as const,
          handler: "score_answer",
          task: null,
        },
      ],
      edges: [],
    } satisfies GraphDefinition;

    const graph = buildAgentGraph(logicDefinition);
    expect(graph.nodes[0]?.data.view.type).toBe("logic");
    expect(graph.nodes[0]?.ariaLabel).toContain("Logic");
    expect(graph.nodes[0]?.data.view.badges).toEqual(["Start", "Result"]);
  });

  it("opens on the entry point and inspects whichever node is clicked", () => {
    render(createElement(AgentGraph, { definition }));

    expect(screen.getByLabelText("Fetch options chain details")).toBeVisible();

    fireEvent.click(screen.getByLabelText(/^Answer, Model/));

    expect(screen.getByLabelText("Answer details")).toBeVisible();
    expect(
      screen.queryByLabelText("Fetch options chain details"),
    ).not.toBeInTheDocument();
  });
});
