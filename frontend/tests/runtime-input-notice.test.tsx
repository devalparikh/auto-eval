import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeInputNotice } from "@/features/systems/runtime-input-notice";
import type { GraphDefinition } from "@/lib/types";

const definition = {
  entry_point: "fetch",
  output_node: "fetch",
  nodes: [
    {
      id: "fetch",
      label: "Fetch options chain",
      kind: "deterministic",
      handler: "fetch_options",
      task: null,
      runtime_input_policy: {
        source: "options_chain",
        runtime_mode: "refresh",
        evaluation_mode: "locked",
        schema_version: 1,
        required: false,
      },
    },
  ],
  edges: [],
} satisfies GraphDefinition;

describe("RuntimeInputNotice", () => {
  afterEach(cleanup);

  it("says a run fetches new data, and which nodes are optional", () => {
    render(<RuntimeInputNotice definition={definition} context="run" />);
    expect(screen.getByText("Live data in this run")).toBeVisible();
    expect(screen.getByText(/fetch data from outside the app/)).toBeVisible();
    expect(
      screen.getByText(/Fetch options chain — Fetches new data. Optional./),
    ).toBeVisible();
  });

  it("says every evaluation example uses its pinned snapshot", () => {
    render(<RuntimeInputNotice definition={definition} context="evaluation" />);
    expect(screen.getByText("Live data in evaluations")).toBeVisible();
    expect(
      screen.getByText(/exact snapshot pinned to it, so scores stay/),
    ).toBeVisible();
    expect(
      screen.getByText(/Uses the snapshot pinned to each example./),
    ).toBeVisible();
  });
});
