import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeSnapshotRefs } from "@/features/systems/runtime-snapshot-refs";
import { ResourceSnapshotRefs } from "@/features/systems/resource-snapshot-refs";

describe("RuntimeSnapshotRefs", () => {
  afterEach(cleanup);

  it("deep-links a node binding to the generic snapshot artifact", () => {
    render(
      <RuntimeSnapshotRefs
        systemKey="portfolio-query"
        bindings={{ load_market_data: "runtime-snapshot-12345678" }}
      />,
    );
    expect(screen.getByText(/load_market_data/)).toBeVisible();
    expect(screen.getByRole("link", { name: /Open snapshot/ })).toHaveAttribute(
      "href",
      "/systems/portfolio-query/artifacts?snapshot=runtime-snapshot-12345678",
    );
  });
});

describe("ResourceSnapshotRefs", () => {
  afterEach(cleanup);

  it("deep-links a canonical consumer binding to its exact resource snapshot", () => {
    render(
      <ResourceSnapshotRefs
        systemKey="portfolio-query"
        bindings={{
          get_indexed_portfolio: {
            mode: "locked",
            snapshot_id: "portfolio-snapshot-12345678",
          },
        }}
      />,
    );
    expect(screen.getByText(/get_indexed_portfolio/)).toBeVisible();
    expect(screen.getByRole("link", { name: /Open resource/ })).toHaveAttribute(
      "href",
      "/systems/portfolio-query/artifacts?snapshot=portfolio-snapshot-12345678",
    );
  });
});
