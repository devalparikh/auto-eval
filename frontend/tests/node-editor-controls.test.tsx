import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphNodeEditorControls } from "@/features/graph/node-editor-controls";
import type { GraphNodeDefinition } from "@/lib/types";

const liveNode: GraphNodeDefinition = {
  id: "load_portfolio_market_data",
  label: "Resolve or fetch external options observation",
  kind: "deterministic",
  handler: "load_portfolio_market_data",
  task: null,
  runtime_input_policy: {
    source: "options_chain",
    schema_version: 1,
    required: false,
    runtime_mode: "refresh",
    evaluation_mode: "locked",
  },
};

const modelNode: GraphNodeDefinition = {
  id: "answer",
  label: "Explain computed answer",
  kind: "llm",
  handler: "answer",
  task: "answer",
  prompt_key: "answer-prompt",
};

describe("GraphNodeEditorControls", () => {
  afterEach(cleanup);

  it("shows the current choice and what each one does to a run", () => {
    render(<GraphNodeEditorControls node={liveNode} onEdit={vi.fn()} />);

    expect(
      screen.getByRole("radio", { name: /Fetch new data each run/ }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: /Use a saved snapshot/ }),
    ).not.toBeChecked();
    expect(
      screen.getByText(
        "Runs reuse data that was saved earlier. You choose which snapshot on the run page.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/Evaluations always use the data saved with each example/),
    ).toBeVisible();
  });

  it("reports the choice without changing anything itself", () => {
    const onEdit = vi.fn();
    render(<GraphNodeEditorControls node={liveNode} onEdit={onEdit} />);

    fireEvent.click(screen.getByRole("radio", { name: /Use a saved snapshot/ }));

    expect(onEdit).toHaveBeenCalledWith({
      nodeId: "load_portfolio_market_data",
      field: "live_data_run_behaviour",
      value: "locked",
    });
    expect(liveNode.runtime_input_policy?.runtime_mode).toBe("refresh");
  });

  it("renders nothing for a node with no settings", () => {
    const { container } = render(
      <GraphNodeEditorControls node={modelNode} onEdit={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
