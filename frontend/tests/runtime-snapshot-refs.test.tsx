import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeSnapshotRefs } from "@/features/systems/runtime-snapshot-refs";

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
