import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { NodeSnapshotBrowser } from "@/features/systems/node-snapshot-browser";
import type { NodeSnapshotDetail, NodeSnapshotSummary } from "@/lib/types";

const usage = {
  trace_id: "trace-query-12345678",
  agent_system_key: "portfolio-query",
  span_id: "span-market-data",
  node_id: "load_portfolio_market_data",
  role: "consumed" as const,
  resolution_mode: "replayed" as const,
  status: "complete",
  latency_ms: 42,
  started_at: "2026-08-10T16:00:00Z",
  completed_at: "2026-08-10T16:00:00Z",
  error: null,
  metadata: { trace_origin: "evaluation", model_id: "mock/portfolio-analyst" },
};

const marketSnapshot = {
  id: "market-snapshot-12345678",
  agent_system_id: "query-system",
  agent_system_key: "portfolio-query",
  product_key: "portfolio-analyst",
  flow_key: "query",
  flow_name: "Portfolio Query",
  node_id: "load_portfolio_market_data",
  node_label: "Load portfolio market data",
  node_kind: "external_input" as const,
  output_key: "options_chain",
  resource_identity: null,
  snapshot_kind: "external_observation" as const,
  schema_version: 1,
  label: "Synthetic options chain",
  observed_at: "2026-08-10T16:00:00Z",
  captured_at: "2026-08-10T16:00:01Z",
  source: "options_chain",
  provider: "synthetic",
  capture_mode: "seeded" as const,
  is_synthetic: true,
  content_hash: "market-hash-1234567890",
  usage_count: 1,
  latest_usage: usage,
} satisfies NodeSnapshotSummary;

const portfolioSnapshot = {
  ...marketSnapshot,
  id: "portfolio-snapshot-12345678",
  agent_system_id: "index-system",
  agent_system_key: "portfolio-analyst",
  flow_key: "index",
  flow_name: "Portfolio Index",
  node_id: "persist_portfolio_snapshot",
  node_label: "Persist portfolio state",
  node_kind: "deterministic" as const,
  output_key: "portfolio_state",
  resource_identity: "main_synthetic_portfolio",
  snapshot_kind: "state" as const,
  label: "Synthetic current portfolio",
  capture_mode: "computed" as const,
  provider: null,
  content_hash: "portfolio-hash-123456",
  usage_count: 0,
  latest_usage: null,
} satisfies NodeSnapshotSummary;

const details: Record<string, NodeSnapshotDetail> = {
  [marketSnapshot.id]: {
    ...marketSnapshot,
    provenance: { freshness: { status: "fresh" } },
    node_metadata: { contract_count: 2, output_contract: "options_chain" },
    usages: [usage],
    content_available: true,
    content: { contracts: [{ symbol: "SYNTH" }] },
  },
  [portfolioSnapshot.id]: {
    ...portfolioSnapshot,
    provenance: { source_kind: "synthetic" },
    node_metadata: { position_count: 2, output_contract: "portfolio_state" },
    usages: [],
    content_available: true,
    content: { positions: [{ symbol: "SYNTH" }] },
  },
};

function Harness() {
  const [selected, setSelected] = useState(marketSnapshot.id);
  return (
    <NodeSnapshotBrowser
      systemKey="portfolio-query"
      snapshots={[marketSnapshot, portfolioSnapshot]}
      selectedSnapshotId={selected}
      onSnapshotChange={setSelected}
      detail={details[selected] ?? null}
      loading={false}
      error={null}
      retry={() => undefined}
    />
  );
}

describe("NodeSnapshotBrowser", () => {
  afterEach(cleanup);

  it("groups snapshots by the node that saved them", () => {
    render(<Harness />);

    expect(screen.getByText("Nodes")).toBeVisible();
    expect(screen.getByText("Load portfolio market data")).toBeVisible();
    expect(screen.getByText("Persist portfolio state")).toBeVisible();
    expect(screen.getByText("Reused by this run")).toBeVisible();
    expect(screen.getByText("42ms")).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Reused by this run/ }),
    ).toHaveAttribute(
      "href",
      "/systems/portfolio-query/traces/trace-query-12345678",
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Persist portfolio state/ }),
    );
    expect(
      screen.getByRole("heading", { name: "Synthetic current portfolio" }),
    ).toBeVisible();
    expect(screen.getAllByText("Saved by a run").length).toBeGreaterThan(0);
  });
});
