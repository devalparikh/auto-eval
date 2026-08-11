import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeInputSnapshotArtifact } from "@/features/systems/runtime-input-snapshot-artifact";
import type { RuntimeInputSnapshotDetail } from "@/lib/types";

const detail = {
  id: "runtime-snapshot-12345678",
  agent_system_id: "portfolio-query",
  source_trace_id: "trace-12345678",
  node_id: "load_portfolio_market_data",
  source_key: "options_chain",
  schema_version: 1,
  label: "Options chain observation",
  observed_at: "2026-08-10T15:00:00Z",
  fetched_at: "2026-08-10T15:00:01Z",
  provider: "synthetic-fixture",
  source_kind: "external_api",
  is_synthetic: true,
  content_hash: "a".repeat(64),
  created_at: "2026-08-10T15:00:02Z",
  provenance: { endpoint: "fixture://options" },
  content_available: true,
  content: { contracts: [{ symbol: "ACME" }] },
} satisfies RuntimeInputSnapshotDetail;

describe("RuntimeInputSnapshotArtifact", () => {
  afterEach(cleanup);

  it("shows external-input provenance and safe captured content", () => {
    render(
      <RuntimeInputSnapshotArtifact
        systemKey="portfolio-query"
        snapshots={[detail]}
        selectedSnapshotId={detail.id}
        onSnapshotChange={vi.fn()}
        detail={detail}
        loading={false}
        error={null}
        retry={vi.fn()}
      />,
    );

    expect(screen.getByText("Runtime observations")).toBeVisible();
    expect(screen.getAllByText("options_chain").length).toBeGreaterThan(0);
    expect(screen.getByText("synthetic-fixture")).toBeVisible();
    expect(screen.getByText("external_api · synthetic")).toBeVisible();
    expect(screen.getByRole("link", { name: "trace-12" })).toHaveAttribute(
      "href",
      "/systems/portfolio-query/traces/trace-12345678",
    );

    fireEvent.click(screen.getByRole("button", { name: "Content" }));
    expect(screen.getByText("Synthetic observation content")).toBeVisible();
    expect(screen.getByText('"ACME"')).toBeInTheDocument();
  });

  it("labels real records and renders their safe shape projection", () => {
    render(
      <RuntimeInputSnapshotArtifact
        systemKey="portfolio-query"
        snapshots={[{ ...detail, is_synthetic: false }]}
        selectedSnapshotId={detail.id}
        onSnapshotChange={vi.fn()}
        detail={{
          ...detail,
          is_synthetic: false,
          content: { schema_version: 1, shape: { contracts: "list" } },
        }}
        loading={false}
        error={null}
        retry={vi.fn()}
      />,
    );
    expect(screen.getByText("external_api · real")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Content" }));
    expect(screen.getByText("Safe observation content")).toBeVisible();
    expect(screen.getByText("contracts")).toBeInTheDocument();
  });
});
