import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HoverGlide } from "@/components/hover-glide";

afterEach(cleanup);

/** jsdom drops `pointerType` from simulated pointer events. */
function pointerOver(element: Element, pointerType: string) {
  const event = createEvent.pointerOver(element);
  Object.defineProperty(event, "pointerType", { value: pointerType });
  fireEvent(element, event);
}

function renderList() {
  const { container } = render(
    <HoverGlide aria-label="Rows" as="nav">
      <p>Heading</p>
      <button className="data-row">First</button>
      <button className="data-row">Second</button>
    </HoverGlide>,
  );
  return container.querySelector(".glide-pill") as HTMLElement;
}

describe("HoverGlide", () => {
  it("shows the highlight over a row and hides it on leaving the list", () => {
    const pill = renderList();
    expect(pill).toHaveAttribute("data-visible", "false");
    pointerOver(screen.getByText("First"), "mouse");
    expect(pill).toHaveAttribute("data-visible", "true");
    fireEvent.pointerLeave(screen.getByRole("navigation", { name: "Rows" }));
    expect(pill).toHaveAttribute("data-visible", "false");
  });

  it("ignores anything that is not a row, and touch", () => {
    const pill = renderList();
    pointerOver(screen.getByText("Heading"), "mouse");
    expect(pill).toHaveAttribute("data-visible", "false");
    pointerOver(screen.getByText("First"), "touch");
    expect(pill).toHaveAttribute("data-visible", "false");
  });

  it("stays out of the accessibility tree", () => {
    expect(renderList()).toHaveAttribute("aria-hidden", "true");
  });
});
