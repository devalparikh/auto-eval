import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DottedText } from "@/components/dotted-text";
import { calculateRepulsionTarget } from "@/components/dotted-text-canvas";

describe("DottedText", () => {
  it("renders real text and exposes reusable dot controls", () => {
    render(
      <DottedText
        color="#d28e61"
        dotSize={1.5}
        dotSpacing={5}
        title="Failure state"
      >
        breaks.
      </DottedText>,
    );

    const text = screen.getByText("breaks.");
    const root = text.parentElement;

    expect(root).toHaveAttribute("title", "Failure state");
    expect(root?.style.getPropertyValue("--dotted-text-color")).toBe(
      "#d28e61",
    );
    expect(root?.style.getPropertyValue("--dotted-text-dot-size")).toBe(
      "1.5px",
    );
    expect(root?.style.getPropertyValue("--dotted-text-dot-spacing")).toBe(
      "5px",
    );
    expect(root?.querySelector("canvas")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("pushes nearby dots away from the pointer", () => {
    expect(
      calculateRepulsionTarget(
        { x: 0, y: 0 },
        { active: true, x: 5, y: 0 },
        10,
        20,
      ),
    ).toEqual({ x: -5, y: 0 });

    expect(
      calculateRepulsionTarget(
        { x: 20, y: 0 },
        { active: true, x: 5, y: 0 },
        10,
        20,
      ),
    ).toEqual({ x: 20, y: 0 });
  });
});
