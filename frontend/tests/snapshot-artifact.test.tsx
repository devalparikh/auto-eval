import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SnapshotArtifact } from "@/features/systems/snapshot-artifact";
import type { PortfolioSnapshotDetail } from "@/lib/types";

const detail = {
  id: "snapshot-1",
  agent_system_id: "portfolio-analyst",
  source_trace_id: "trace-1",
  resource_identity: "main_synthetic_portfolio",
  schema_version: 1,
  label: "Synthetic portfolio",
  as_of: "2026-08-10T12:00:00Z",
  source_kind: "indexed",
  is_synthetic: true,
  content_hash: "a".repeat(64),
  position_count: 3,
  created_at: "2026-08-10T12:00:00Z",
  content_available: true,
  content: { positions: [{ ticker: "ACME" }] },
} satisfies PortfolioSnapshotDetail;

describe("SnapshotArtifact", () => {
  afterEach(cleanup);

  it("separates immutable snapshot metadata from stored content", () => {
    render(
      <SnapshotArtifact
        snapshots={[detail]}
        selectedSnapshotId={detail.id}
        onSnapshotChange={vi.fn()}
        detail={detail}
        loading={false}
        error={null}
        retry={vi.fn()}
      />,
    );

    expect(screen.getByText("trace-1")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Content" }));
    expect(screen.getByText("Snapshot content")).toBeVisible();
    expect(screen.getByText('"ACME"')).toBeInTheDocument();
  });

  it("explains when the reveal policy hides content", () => {
    render(
      <SnapshotArtifact
        snapshots={[detail]}
        selectedSnapshotId={detail.id}
        onSnapshotChange={vi.fn()}
        detail={{ ...detail, content_available: false, content: {} }}
        loading={false}
        error={null}
        retry={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Content" }));
    expect(screen.getByText("Content is not available")).toBeVisible();
    expect(screen.getByText(/local reveal policy/)).toBeVisible();
  });
});
