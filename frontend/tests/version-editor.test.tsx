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

describe("VersionEditor", () => {
  afterEach(cleanup);

  it("shows a visual structure, raw source, and accessible fullscreen view", async () => {
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

    expect(screen.getByText("Inline graph")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Expand graph" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeVisible());
    expect(screen.getByText("Fullscreen graph")).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(screen.getByLabelText("Graph definition")).toHaveValue(graphSource);
  });
});
