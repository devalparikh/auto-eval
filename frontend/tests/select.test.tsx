import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MultiSelect, optionsFromChildren, Select } from "@/components/select";

afterEach(cleanup);

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

describe("Select dropdown", () => {
  function renderSelect(onChange = vi.fn()) {
    render(
      <Select aria-label="Graph" name="graph" defaultValue="v1" onChange={onChange}>
        <option value="v1">Version 1</option>
        <option value="v2">Version 2</option>
      </Select>,
    );
    return {
      onChange,
      select: screen.getByRole<HTMLSelectElement>("combobox", { name: "Graph" }),
    };
  }

  it("picks through the native select, so onChange and the value stay real", () => {
    const { onChange, select } = renderSelect();
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: "Version 2",
      }),
    );
    expect(onChange).toHaveBeenCalledOnce();
    expect(select.value).toBe("v2");
    expect(select).toHaveFocus();
  });

  it("moves with the keyboard, selects with Enter, and closes with Escape", () => {
    const { select } = renderSelect();
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.keyDown(select, { key: "Enter" });
    expect(select.value).toBe("v2");

    fireEvent.keyDown(select, { key: "ArrowDown" });
    expect(select).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(select, { key: "Escape" });
    expect(select).toHaveAttribute("aria-expanded", "false");
    expect(select.value).toBe("v2");
  });

  it("does not let Escape reach a surrounding modal", () => {
    const onDocumentKey = vi.fn();
    document.addEventListener("keydown", onDocumentKey);
    const { select } = renderSelect();
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.keyDown(select, { key: "Escape" });
    expect(onDocumentKey).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: "Escape" }),
    );
    document.removeEventListener("keydown", onDocumentKey);
  });

  it("reads groups and details from native option markup", () => {
    expect(
      optionsFromChildren(
        <optgroup label="Local">
          <option value="a" data-detail="Also image">
            Model {"A"}
          </option>
        </optgroup>,
      ),
    ).toEqual([
      {
        value: "a",
        label: "Model A",
        detail: "Also image",
        group: "Local",
        disabled: false,
      },
    ]);
  });
});

describe("MultiSelect", () => {
  const options = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta" },
    { value: "c", label: "Gamma" },
    { value: "d", label: "Delta" },
  ];

  it("stays open while toggling and summarizes long selections", () => {
    const onChange = vi.fn();
    render(
      <MultiSelect
        label="Models"
        options={options}
        selected={["a", "b", "c"]}
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Models" });
    expect(trigger).toHaveTextContent("Alpha, Beta, 1 more");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Delta" }));
    expect(onChange).toHaveBeenCalledWith(["a", "b", "c", "d"]);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("searches long lists", () => {
    render(
      <MultiSelect
        label="Models"
        options={Array.from({ length: 9 }, (_, index) => ({
          value: `m${index}`,
          label: `Model ${index}`,
        }))}
        selected={[]}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Models" }));
    fireEvent.change(screen.getByLabelText("Search options"), {
      target: { value: "Model 7" },
    });
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});
