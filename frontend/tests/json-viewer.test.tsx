import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JsonViewer } from "@/components/json-viewer";

describe("JsonViewer", () => {
  it("exposes nested objects through native disclosure controls", () => {
    const { container } = render(
      <JsonViewer
        value={{
          edges: [{ source: "normalize_input", target: "classify_incident" }],
        }}
      />,
    );

    const branches = [...container.querySelectorAll("details")];
    expect(branches.length).toBeGreaterThan(2);
    expect(screen.getByText("edges").closest("summary")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(branches.every((branch) => !branch.open)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(branches.every((branch) => branch.open)).toBe(true);
    expect(screen.getByText('"classify_incident"')).toBeVisible();
  });
});
