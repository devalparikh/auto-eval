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
}));

const graphSource = JSON.stringify(
  {
    entry_point: "prepare",
    output_node: "answer",
    nodes: [
      {
        id: "prepare",
        label: "Prepare",
        kind: "deterministic",
        handler: "input",
        task: null,
        response_schema: { type: "object" },
      },
      {
        id: "answer",
        label: "Answer",
        kind: "llm",
        handler: "llm_response",
        task: "Answer the request",
        prompt_key: "answer-prompt",
      },
    ],
    edges: [{ source: "prepare", target: "answer" }],
  },
  null,
  2,
);

function renderGraphEditor(
  overrides: Partial<React.ComponentProps<typeof VersionEditor>> = {},
) {
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
      {...overrides}
    />,
  );
}

describe("VersionEditor", () => {
  afterEach(cleanup);

  it("switches between preview, visual editing, and source", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(screen.getByLabelText("Graph definition")).toHaveValue(graphSource);
    expect(
      screen.queryByRole("button", { name: "Expand graph" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit graph" }));
    expect(screen.getByRole("region", { name: "Graph editor" })).toBeVisible();
    expect(screen.getByLabelText("Prepare editor")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText("Inline graph")).toBeVisible();
  });

  it("drops the narration from the graph toolbar", () => {
    renderGraphEditor();

    expect(
      screen.queryByText("Inspect nodes, edges, and prompt associations."),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(
      screen.queryByText("Edit the raw definition to create a new version."),
    ).not.toBeInTheDocument();
  });

  it("saves visual edits as a new version without dropping advanced fields", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderGraphEditor({ onSave });

    fireEvent.click(screen.getByRole("button", { name: "Edit graph" }));
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "Prepare request" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const [, source] = onSave.mock.calls[0] as [string, string];
    const saved = JSON.parse(source) as {
      nodes: Array<{ label: string; response_schema?: unknown }>;
    };
    expect(saved.nodes[0]?.label).toBe("Prepare request");
    expect(saved.nodes[0]?.response_schema).toEqual({ type: "object" });
  });

  it("asks before changing versions with unsaved source edits", () => {
    const onVersionChange = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderGraphEditor({
      versions: [
        { id: "graph-1", version: 1, created_at: "2026-08-10" },
        { id: "graph-2", version: 2, created_at: "2026-08-11" },
      ],
      onVersionChange,
    });

    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    fireEvent.change(screen.getByLabelText("Graph definition"), {
      target: { value: `${graphSource}\n` },
    });
    fireEvent.change(screen.getByLabelText("graph version"), {
      target: { value: "graph-2" },
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(onVersionChange).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.change(screen.getByLabelText("graph version"), {
      target: { value: "graph-2" },
    });
    expect(onVersionChange).toHaveBeenCalledWith("graph-2");
    confirm.mockRestore();
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
