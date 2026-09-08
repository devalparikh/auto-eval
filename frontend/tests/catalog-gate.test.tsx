import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogGate } from "@/components/catalog-gate";
import { useCatalog } from "@/lib/use-catalog";
import type { Catalog } from "@/lib/types";

vi.mock("@/lib/use-catalog", () => ({ useCatalog: vi.fn() }));

afterEach(cleanup);

describe("CatalogGate", () => {
  it("preserves an editor's draft while refreshing the existing catalog", () => {
    const catalog = {
      agent_systems: [{ id: "system-1", key: "test-agent", versions: [] }],
      prompts: [],
      datasets: [],
      models: [],
    } as unknown as Catalog;
    const state = {
      data: catalog,
      error: null,
      loading: false,
      reload: vi.fn(),
    };
    vi.mocked(useCatalog).mockReturnValue(state);
    const content = () => (
      <CatalogGate systemKey="test-agent">
        {() => <input aria-label="Draft" defaultValue="Original" />}
      </CatalogGate>
    );
    const { rerender } = render(content());
    fireEvent.change(screen.getByLabelText("Draft"), {
      target: { value: "Unsaved edit" },
    });

    vi.mocked(useCatalog).mockReturnValue({ ...state, loading: true });
    rerender(content());
    expect(screen.getByLabelText("Draft")).toHaveValue("Unsaved edit");

    vi.mocked(useCatalog).mockReturnValue({ ...state, data: { ...catalog } });
    rerender(content());
    expect(screen.getByLabelText("Draft")).toHaveValue("Unsaved edit");
  });
});
