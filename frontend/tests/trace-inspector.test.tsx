import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TraceInspector } from "@/features/traces/trace-inspector";
import type { TraceSpan } from "@/lib/types";

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

  it("links an external-input span to its exact observation", () => {
    render(<TraceInspector span={span} systemKey="portfolio-query" />);
    expect(screen.getByText("Data resolution")).toBeVisible();
    expect(screen.getByText("Snapshot replayed")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/systems/portfolio-query/artifacts?snapshot=runtime-snapshot-12345678",
    );
  });

  it("shows live resolution metadata even when capture was disabled", () => {
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
        systemKey="portfolio-query"
      />,
    );
    expect(screen.getByText("Live data: not saved")).toBeVisible();
    expect(screen.getByText("Resolution metadata")).toBeVisible();
  });
});
