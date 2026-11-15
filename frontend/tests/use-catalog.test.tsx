import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { useCatalog } from "@/lib/use-catalog";
import { transitionApiSession } from "@/lib/api-session";
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
      <span data-testid={`${testId}-names`}>
        {catalog.data?.agent_systems.map((item) => item.name).join(",") ?? "none"}
      </span>
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

  it("never shows one identity's catalog to the next, even when its response arrives late", async () => {
    const adminCatalog = {
      ...emptyCatalog,
      agent_systems: [{ ...system, name: "Admin-only system" }],
    } satisfies Catalog;
    const viewerCatalog = {
      ...emptyCatalog,
      agent_systems: [{ ...system, id: "system-2", name: "Viewer system" }],
    } satisfies Catalog;
    act(() => transitionApiSession("admin-subject"));
    vi.mocked(api.catalog).mockReset().mockResolvedValueOnce(adminCatalog);
    const view = render(<Consumer testId="a" />);
    await waitFor(() =>
      expect(screen.getByTestId("a-names")).toHaveTextContent("Admin-only system"),
    );

    // The admin reloads; that response is still in flight at sign-out.
    let finishAdmin!: (value: Catalog) => void;
    vi.mocked(api.catalog).mockImplementationOnce(
      () => new Promise<Catalog>((resolve) => { finishAdmin = resolve; }),
    );
    await act(async () => {
      screen.getByRole("button", { name: "reload-a" }).click();
    });

    // A viewer signs in on the same page; their own request is slow too.
    let finishViewer!: (value: Catalog) => void;
    vi.mocked(api.catalog).mockImplementationOnce(
      () => new Promise<Catalog>((resolve) => { finishViewer = resolve; }),
    );
    act(() => transitionApiSession("viewer-subject"));
    expect(screen.getByTestId("a-names")).toHaveTextContent("none");
    expect(screen.getByTestId("a-count")).toHaveTextContent("loading");
    await waitFor(() => expect(api.catalog).toHaveBeenCalledTimes(3));

    await act(async () => finishAdmin(adminCatalog));
    expect(screen.getByTestId("a-names")).toHaveTextContent("none");

    await act(async () => finishViewer(viewerCatalog));
    expect(screen.getByTestId("a-names")).toHaveTextContent("Viewer system");
    expect(screen.queryByText(/Admin-only system/)).toBeNull();
    view.unmount();

    // A later screen mounted under the viewer reads the viewer's catalog only.
    render(<Consumer testId="b" />);
    expect(screen.getByTestId("b-names")).toHaveTextContent("Viewer system");
    expect(api.catalog).toHaveBeenCalledTimes(3);
  });

  it("drops the catalog when the session denies it", async () => {
    act(() => transitionApiSession("revoked-subject"));
    vi.mocked(api.catalog)
      .mockReset()
      .mockResolvedValueOnce(reloadedCatalog)
      .mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { status: 403 }));
    render(<Consumer testId="a" />);
    await waitFor(() =>
      expect(screen.getByTestId("a-names")).toHaveTextContent("Research Agent"),
    );
    await act(async () => {
      screen.getByRole("button", { name: "reload-a" }).click();
    });
    await waitFor(() => expect(screen.getByTestId("a-names")).toHaveTextContent("none"));
  });
});
