import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TraceInspector } from "@/features/traces/trace-inspector";
import type { GraphNodeDefinition, TraceSpan } from "@/lib/types";

const node = {
  id: "load_market_data",
  label: "Load market data",
  kind: "deterministic",
  handler: "load_market_data",
  task: null,
  runtime_input_policy: {
    source: "market_quotes",
    runtime_mode: "locked",
    evaluation_mode: "locked",
    schema_version: 1,
    required: true,
  },
} satisfies GraphNodeDefinition;

const span = {
  id: "span-1",
  trace_id: "trace-1",
  node_id: "load_market_data",
  node_kind: "deterministic",
  sequence: 1,
  status: "complete",
  system_prompt: null,
  input: {},
  output: { contracts: 2 },
  error: null,
  latency_ms: 20,
  cost_usd: 0,
  input_tokens: 0,
  output_tokens: 0,
  started_at: "2026-08-10T15:00:00Z",
  completed_at: "2026-08-10T15:00:01Z",
  runtime_input_snapshot_id: "runtime-snapshot-12345678",
  node_snapshot_id: "runtime-snapshot-12345678",
  snapshot_role: "consumed",
  snapshot_resolution_mode: "replayed",
} satisfies TraceSpan;

describe("TraceInspector", () => {
  afterEach(cleanup);

  it("shows the shared node details and links the saved copy it used", () => {
    render(
      <TraceInspector
        span={span}
        node={node}
        entry
        systemKey="portfolio-query"
      />,
    );
    expect(
      screen.getByRole("region", { name: "Load market data details" }),
    ).toBeVisible();
    expect(screen.getAllByText("Live data").length).toBeGreaterThan(0);
    expect(screen.getByText("market_quotes")).toBeVisible();
    expect(screen.getByText("Snapshot")).toBeVisible();
    expect(screen.getByText("Used a saved copy")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/systems/portfolio-query/artifacts?snapshot=runtime-snapshot-12345678",
    );
  });

  it("says nothing was saved when the step kept no copy", () => {
    render(
      <TraceInspector
        span={{
          ...span,
          runtime_input_snapshot_id: null,
          node_snapshot_id: null,
          snapshot_role: null,
          snapshot_resolution_mode: "live",
          snapshot_metadata: {
            provider: "market-provider",
            observed_at: "2026-08-10T15:00:00Z",
          },
        }}
        node={node}
        systemKey="portfolio-query"
      />,
    );
    expect(screen.getByText("Snapshot")).toBeVisible();
    expect(screen.getByText("Nothing saved")).toBeVisible();
    expect(screen.getByText("Details")).toBeVisible();
  });

  it("copies the node output to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <TraceInspector span={span} node={node} systemKey="portfolio-query" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        JSON.stringify(span.output, null, 2),
      ),
    );
    expect(await screen.findByRole("button", { name: "Copied" })).toBeVisible();
  });

  it("prompts for a selection when no node is active", () => {
    render(
      <TraceInspector span={null} node={null} systemKey="portfolio-query" />,
    );
    expect(screen.getByText("Select a node to see what it did.")).toBeVisible();
  });
});
