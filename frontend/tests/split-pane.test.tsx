import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SplitPane } from "@/components/split-pane";
import { paneCollapsedFromCookie, sidebarStateFromCookie } from "@/lib/sidebar";

afterEach(() => {
  cleanup();
  document.cookie = "autoeval-pane-test=; Path=/; Max-Age=0";
});

function renderPane(initialCollapsed = false) {
  render(
    <SplitPane
      id="test"
      label="Trace list"
      initialCollapsed={initialCollapsed}
      pane={<button type="button">In the pane</button>}
    >
      <p>Main content</p>
    </SplitPane>,
  );
}

describe("SplitPane", () => {
  it("hides the pane from focus and remembers the choice", () => {
    renderPane();
    fireEvent.click(screen.getByRole("button", { name: "Hide trace list" }));
    const pane = screen.getByLabelText("Trace list");
    expect(pane).toHaveAttribute("inert");
    expect(document.cookie).toContain("autoeval-pane-test=collapsed");

    fireEvent.click(screen.getByRole("button", { name: "Show trace list" }));
    expect(pane).not.toHaveAttribute("inert");
    expect(document.cookie).toContain("autoeval-pane-test=expanded");
  });

  it("starts collapsed when the server read that from the cookie", () => {
    renderPane(true);
    expect(screen.getByRole("button", { name: "Show trace list" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByText("Main content")).toBeVisible();
  });

  it("toggles with its keyboard shortcut", () => {
    renderPane();
    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(screen.getByRole("button", { name: "Show trace list" })).toBeVisible();
  });
});

describe("layout cookies", () => {
  it("defaults to expanded for anything unexpected", () => {
    expect(sidebarStateFromCookie("collapsed")).toBe("collapsed");
    expect(sidebarStateFromCookie("nonsense")).toBe("expanded");
    expect(sidebarStateFromCookie(undefined)).toBe("expanded");
    expect(paneCollapsedFromCookie("collapsed")).toBe(true);
    expect(paneCollapsedFromCookie(undefined)).toBe(false);
  });
});
