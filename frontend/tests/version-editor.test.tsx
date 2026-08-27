import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VersionEditor } from "@/features/systems/version-editor";

vi.mock("@/features/systems/agent-graph", () => ({
  AgentGraph: ({ fullscreen = false }: { fullscreen?: boolean }) => (
    <div aria-label="Agent graph structure">
      {fullscreen ? "Fullscreen graph" : "Inline graph"}
    </div>
  ),
  isGraphDefinition: () => true,
}));

const graphSource = JSON.stringify({
  entry_point: "answer",
  output_node: "answer",
  nodes: [],
  edges: [],
});

function renderGraphEditor() {
  render(
    <VersionEditor
      kind="graph"
      title="Research agent"
      description="Research graph"
      icon={<span>G</span>}
      versions={[{ id: "graph-1", version: 1, created_at: "2026-08-10" }]}
      selectedVersionId="graph-1"
      onVersionChange={vi.fn()}
      content={graphSource}
      loading={false}
      recordId="system-1"
      onSave={vi.fn()}
    />,
  );
}

describe("VersionEditor", () => {
  afterEach(cleanup);

  it("switches between the graph and the JSON definition", async () => {
    renderGraphEditor();

    expect(screen.getByText("Inline graph")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Expand graph" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeVisible());
    expect(screen.getByText("Fullscreen graph")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Agent graph" })).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    expect(screen.getByLabelText("Graph definition")).toHaveValue(graphSource);
    expect(
      screen.queryByRole("button", { name: "Expand graph" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    expect(screen.getByText("Inline graph")).toBeVisible();
  });

  it("drops the narration from the graph toolbar", () => {
    renderGraphEditor();

    expect(
      screen.queryByText("Inspect nodes, edges, and prompt associations."),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    expect(
      screen.queryByText("Edit the raw definition to create a new version."),
    ).not.toBeInTheDocument();
  });

  it("lists the graph nodes a prompt is used by without separators", () => {
    render(
      <VersionEditor
        kind="prompt"
        title="Answer prompt"
        description="Answer prompt"
        icon={<span>P</span>}
        versions={[{ id: "prompt-1", version: 1, created_at: "2026-08-10" }]}
        selectedVersionId="prompt-1"
        onVersionChange={vi.fn()}
        content="Answer the question."
        loading={false}
        recordId="prompt-1"
        onSave={vi.fn()}
        associations={[{ nodeId: "answer", label: "Answer" }]}
      />,
    );

    const summary = screen.getByText("Used by 1 node in the selected graph");
    expect(summary).toBeVisible();
    expect(screen.getByText("answer")).toBeVisible();
    expect(summary.parentElement?.textContent).not.toContain("·");
  });
});
