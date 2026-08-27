import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VersionEditor } from "@/features/systems/version-editor";
import type { GraphDefinition } from "@/lib/types";

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

const content = JSON.stringify(definition, null, 2);

function renderEditor(onSave = vi.fn()) {
  render(
    <VersionEditor
      kind="graph"
      title="Portfolio query"
      description="Portfolio query graph"
      icon={<span>G</span>}
      versions={[{ id: "graph-1", version: 3, created_at: "2026-08-10" }]}
      selectedVersionId="graph-1"
      onVersionChange={vi.fn()}
      content={content}
      loading={false}
      recordId="system-1"
      onSave={onSave}
    />,
  );
  return onSave;
}

function chooseSavedSnapshot() {
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("radio", { name: /Use a saved snapshot/ }));
}

describe("VersionEditor graph editing", () => {
  afterEach(cleanup);

  it("hides node settings until the reader asks to edit", () => {
    renderEditor();

    expect(
      screen.queryByRole("radio", { name: /Use a saved snapshot/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(
      screen.getByRole("radio", { name: /Fetch new data each run/ }),
    ).toBeChecked();
  });

  it("reviews the change and saves it as one draft with the JSON view", async () => {
    const onSave = renderEditor();
    const save = screen.getByRole("button", { name: "Save new version" });
    expect(save).toBeDisabled();

    chooseSavedSnapshot();

    expect(
      screen.getByText(
        "Resolve or fetch external options observation — now uses a saved snapshot instead of fetching new data",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("radio", { name: /Use a saved snapshot/ }),
    ).toBeChecked();
    expect(save).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    expect(screen.getByLabelText("Graph definition")).toHaveValue(
      content.replace('"runtime_mode": "refresh"', '"runtime_mode": "locked"'),
    );

    fireEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(
      JSON.parse(onSave.mock.calls[0]![1] as string).nodes[0]
        .runtime_input_policy.runtime_mode,
    ).toBe("locked");
  });

  it("treats a change and its reversal as nothing to save", () => {
    renderEditor();
    chooseSavedSnapshot();

    fireEvent.click(screen.getByRole("radio", { name: /Fetch new data each run/ }));

    expect(
      screen.getByRole("button", { name: "Save new version" }),
    ).toBeDisabled();
    expect(
      screen.queryByText("What the next version changes"),
    ).not.toBeInTheDocument();
  });

  it("asks before throwing away unsaved changes", async () => {
    renderEditor();
    chooseSavedSnapshot();

    fireEvent.click(screen.getByRole("button", { name: "Done editing" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("radio", { name: /Use a saved snapshot/ }),
    ).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Done editing" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("radio", { name: /Use a saved snapshot/ }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Save new version" }),
    ).toBeDisabled();
  });

  it("leaves edit mode without asking when nothing changed", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Done editing" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeVisible();
  });

  it("points the reader at the existing version instead of showing the raw conflict", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValue(new Error("This graph already exists as version 4"));
    renderEditor(onSave);
    chooseSavedSnapshot();

    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "This is already version 4. Choose it from the version list — there is nothing new to save.",
      ),
    );
  });
});
