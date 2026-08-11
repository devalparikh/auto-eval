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

  it("distinguishes direct refreshes from saved business input", () => {
    render(<RuntimeInputNotice definition={definition} context="run" />);
    expect(screen.getByText("Direct run external inputs")).toBeVisible();
    expect(
      screen.getByText(/never capture runtime observations/),
    ).toBeVisible();
    expect(screen.getByText(/options_chain · run refresh/)).toBeVisible();
    expect(screen.getByText(/conditional/)).toBeVisible();
  });

  it("explains dataset-locked observations for evaluation", () => {
    render(<RuntimeInputNotice definition={definition} context="evaluation" />);
    expect(screen.getByText("Evaluation observation bindings")).toBeVisible();
    expect(screen.getByText(/dataset example supplies locked/)).toBeVisible();
    expect(screen.getByText(/options_chain · evaluation locked/)).toBeVisible();
  });
});
