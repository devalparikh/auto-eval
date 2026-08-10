import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { Select } from "@/components/select";

describe("Select", () => {
  it("keeps native select behavior while providing one shared indicator", () => {
    const onChange = vi.fn();
    const ref = createRef<HTMLSelectElement>();
    const { container } = render(
      <Select
        ref={ref}
        aria-label="Version"
        name="version"
        defaultValue="one"
        onChange={onChange}
      >
        <option value="one">Version one</option>
        <option value="two">Version two</option>
      </Select>,
    );

    const select = screen.getByRole("combobox", { name: "Version" });
    expect(select).toHaveValue("one");
    expect(select).toHaveAttribute("name", "version");
    expect(ref.current).toBe(select);
    expect(
      container.querySelectorAll(".select-control-icon[aria-hidden='true']"),
    ).toHaveLength(1);

    fireEvent.change(select, { target: { value: "two" } });
    expect(onChange).toHaveBeenCalledOnce();
    expect(select).toHaveValue("two");
  });

  it("forwards the disabled state to the native control and wrapper", () => {
    const { container } = render(
      <Select aria-label="Disabled version" disabled>
        <option>Version one</option>
      </Select>,
    );

    expect(
      screen.getByRole("combobox", { name: "Disabled version" }),
    ).toBeDisabled();
    expect(container.querySelector(".select-control")).toHaveAttribute(
      "data-disabled",
      "true",
    );
  });
});
