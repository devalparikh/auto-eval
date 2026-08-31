import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentGraph } from "@/features/systems/agent-graph";
import type { GraphDefinition, PromptSummary } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  api: {
    promptVersion: vi.fn().mockResolvedValue({
      id: "prompt-version-1",
      content: "Explain the computed answer.",
    }),
  },
}));

const definition: GraphDefinition = {
  entry_point: "load_market_data",
  output_node: "answer",
  nodes: [
    {
      id: "load_market_data",
      label: "Resolve or fetch external options observation",
      kind: "deterministic",
      handler: "load_market_data",
      task: null,
      runtime_input_policy: {
        source: "options_chain",
        schema_version: 1,
        required: false,
        runtime_mode: "refresh",
        evaluation_mode: "locked",
      },
    },
    {
      id: "answer",
      label: "Explain computed answer",
      kind: "llm",
      handler: "answer",
      task: "answer",
      prompt_key: "answer-prompt",
    },
  ],
  edges: [{ source: "load_market_data", target: "answer" }],
};

const prompts: PromptSummary[] = [
  {
    id: "prompt-1",
    agent_system_id: "system-1",
    key: "answer-prompt",
    name: "Answer prompt",
    description: "Explains the computed answer",
    versions: [{ id: "prompt-version-1", version: 2, created_at: "2026-08-10" }],
  },
];

describe("AgentGraph details panel", () => {
  afterEach(cleanup);

  it("shows a model node's prompt in place with a link to its artifact page", async () => {
    render(
      <AgentGraph
        definition={definition}
        systemKey="portfolio-query"
        prompts={prompts}
      />,
    );

    fireEvent.click(screen.getByLabelText(/^Explain computed answer, Model/));

    expect(screen.getByText("Answer prompt")).toBeVisible();
    expect(await screen.findByText("Explain the computed answer.")).toBeVisible();
    expect(screen.getByRole("link", { name: /Open prompt/ })).toHaveAttribute(
      "href",
      "/systems/portfolio-query/artifacts?artifact=prompt&prompt=answer-prompt",
    );
    expect(
      screen.queryByRole("combobox", { name: /Prompt version/ }),
    ).not.toBeInTheDocument();
  });

  it("skips the prompt panel when the screen has not supplied prompts", () => {
    render(<AgentGraph definition={definition} />);

    fireEvent.click(screen.getByLabelText(/^Explain computed answer, Model/));

    expect(screen.queryByText("Answer prompt")).not.toBeInTheDocument();
  });

  it("says so when an edited node has nothing to change", () => {
    render(
      <AgentGraph definition={definition} editable onDraftChange={vi.fn()} />,
    );

    fireEvent.click(screen.getByLabelText(/^Explain computed answer, Model/));

    expect(
      screen.getByText(
        "This node has nothing to change. Pick a live-data node to choose where it gets its data.",
      ),
    ).toBeVisible();
  });

  it("hands a whole edited definition back rather than changing one in place", () => {
    const onDraftChange = vi.fn();
    render(
      <AgentGraph
        definition={definition}
        editable
        onDraftChange={onDraftChange}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /Use a saved snapshot/ }));

    const next = onDraftChange.mock.calls[0]![0] as GraphDefinition;
    expect(next).not.toBe(definition);
    expect(next.nodes[0]?.runtime_input_policy?.runtime_mode).toBe("locked");
    expect(definition.nodes[0]?.runtime_input_policy?.runtime_mode).toBe(
      "refresh",
    );
  });
});
