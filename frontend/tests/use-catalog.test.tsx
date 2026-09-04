import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { useCatalog } from "@/lib/use-catalog";
import type { AgentSystemSummary, Catalog } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  api: { catalog: vi.fn() },
}));

const emptyCatalog = {
  agent_systems: [],
  prompts: [],
  datasets: [],
  models: [],
} satisfies Catalog;

const system = {
  id: "system-1",
  key: "research-agent",
  product_key: "research-agent",
  flow_key: "run",
  flow_name: "Run",
  name: "Research Agent",
  description: "",
  versions: [],
  default_model_ids: [],
  input_template: {},
  dataset_editor: "json",
  input_editor: "json",
  primary_metric: "accuracy",
} satisfies AgentSystemSummary;

const reloadedCatalog = {
  ...emptyCatalog,
  agent_systems: [system],
} satisfies Catalog;

function Consumer({ testId }: { testId: string }) {
  const catalog = useCatalog();
  return (
    <div>
      <span data-testid={`${testId}-count`}>
        {catalog.loading ? "loading" : catalog.data?.agent_systems.length}
      </span>
      <button onClick={() => void catalog.reload()}>reload-{testId}</button>
    </div>
  );
}

describe("useCatalog", () => {
  afterEach(() => {
    cleanup();
  });

  it("shares one fetch and cache, and reload refreshes every subscriber", async () => {
    vi.mocked(api.catalog)
      .mockResolvedValueOnce(emptyCatalog)
      .mockResolvedValueOnce(reloadedCatalog);

    render(
      <>
        <Consumer testId="a" />
        <Consumer testId="b" />
      </>,
    );

    await waitFor(() => expect(screen.getByTestId("a-count")).toHaveTextContent("0"));
    expect(screen.getByTestId("b-count")).toHaveTextContent("0");
    expect(api.catalog).toHaveBeenCalledTimes(1);

    await act(async () => {
      screen.getByRole("button", { name: "reload-a" }).click();
    });

    await waitFor(() => expect(screen.getByTestId("a-count")).toHaveTextContent("1"));
    expect(screen.getByTestId("b-count")).toHaveTextContent("1");
    expect(api.catalog).toHaveBeenCalledTimes(2);
  });
});
