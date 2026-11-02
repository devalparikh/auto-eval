import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvaluationsScreen } from "@/features/evaluations/evaluations-screen";
import { api, ApiError } from "@/lib/api";
import type { Catalog, DatasetVersionDetail, EvalRun } from "@/lib/types";
import { useCatalog } from "@/lib/use-catalog";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: { datasetVersion: vi.fn(), agentVersion: vi.fn(), createEvalRun: vi.fn() },
  };
});
vi.mock("@/lib/use-catalog", () => ({ useCatalog: vi.fn() }));
vi.mock("@/lib/sound", () => ({ playPreferredUiSound: vi.fn() }));
vi.mock("@/features/evaluations/run-status-panel", () => ({
  RunStatusPanel: ({ runs }: { runs: EvalRun[] }) => (
    <div>{runs.length ? `Runs created: ${runs.length}` : "No run"}</div>
  ),
}));

let details: Record<string, DatasetVersionDetail>;
const reload = vi.fn();
const run = { id: "run", status: "complete", dataset_version_id: "draft" } as EvalRun;

function version(id: string, status: "draft" | "final", number: number, count: number): DatasetVersionDetail {
  return {
    id, status, version: number, dataset_id: "dataset", item_count: count,
    created_at: "2026-01-01", finalized_at: status === "final" ? "2026-01-01" : null,
    content_revision: "a".repeat(64),
    items: Array.from({ length: count }, (_, index) => ({
      id: `${id}-${index}`, dataset_version_id: id,
      input: { text: `Example ${index}` }, expected: { answer: "Reviewed answer" },
      source_trace_id: null, created_at: "2026-01-01", updated_at: "2026-01-01",
    })),
  };
}

async function selectDraft() {
  render(<EvaluationsScreen systemKey="test" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Run benchmark" })).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Dataset version"), { target: { value: "draft" } });
  const button = await screen.findByRole("button", { name: "Finalize & run benchmark" });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

describe("benchmark finalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    details = { final: version("final", "final", 1, 1), draft: version("draft", "draft", 2, 2) };
    const catalog = {
      agent_systems: [{ id: "system", key: "test", name: "Test", versions: [{ id: "graph", version: 1 }], default_model_ids: ["mock/test"] }],
      datasets: [{ id: "dataset", agent_system_id: "system", name: "Cases", versions: Object.values(details) }],
      prompts: [{ agent_system_id: "system", versions: [{ id: "prompt", version: 1 }] }],
      models: [{ id: "mock/test", name: "Mock", label: "Mock", available: true, provider: "mock", supports: ["text"] }],
    } as unknown as Catalog;
    vi.mocked(useCatalog).mockReturnValue({ data: catalog, loading: false, error: null, reload });
    vi.mocked(api.datasetVersion).mockImplementation(async (id) => structuredClone(details[id]));
    vi.mocked(api.agentVersion).mockResolvedValue({ id: "graph", definition: { nodes: [], edges: [] } } as never);
    vi.mocked(api.createEvalRun).mockImplementation(async () => {
      details.draft.status = "final";
      return run;
    });
  });
  afterEach(cleanup);

  it("requires an explicit action and uses the selected version's count and revision", async () => {
    const button = await selectDraft();
    expect(api.createEvalRun).not.toHaveBeenCalled();
    expect(screen.getByText("2 examples per model")).toBeVisible();
    expect(screen.getByText(/permanently finalize v2 with 2 examples/)).toBeVisible();
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByText("Runs created: 1");
    expect(api.createEvalRun).toHaveBeenCalledTimes(1);
    expect(api.createEvalRun).toHaveBeenCalledWith(expect.objectContaining({
      dataset_version_id: "draft", agent_system_version_id: "graph",
      finalize_dataset: true, expected_dataset_revision: "a".repeat(64), request_id: expect.any(String),
    }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Run benchmark" })).toBeEnabled());
    expect(screen.queryByText(/permanently finalize/)).not.toBeInTheDocument();
    expect(reload).toHaveBeenCalled();
  });

  it("does not finalize an already finalized dataset", async () => {
    render(<EvaluationsScreen systemKey="test" />);
    const button = screen.getByRole("button", { name: "Run benchmark" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await screen.findByText("Runs created: 1");
    expect(api.createEvalRun).toHaveBeenCalledWith(expect.objectContaining({ dataset_version_id: "final" }));
    expect(vi.mocked(api.createEvalRun).mock.calls[0][0]).not.toHaveProperty("finalize_dataset");
  });

  it("requires refresh and another explicit click after a stale draft rejection", async () => {
    vi.mocked(api.createEvalRun).mockRejectedValueOnce(new ApiError("The dataset changed since you loaded it.", 409));
    fireEvent.click(await selectDraft());
    await screen.findByRole("alert");
    details.draft.content_revision = "b".repeat(64);
    details.draft.items[0].expected = { answer: "Corrected answer" };
    fireEvent.click(screen.getByRole("button", { name: "Refresh dataset" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(api.createEvalRun).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Review dataset examples"));
    expect(screen.getByText(/Corrected answer/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Finalize & run benchmark" }));
    await screen.findByText("Runs created: 1");
    expect(vi.mocked(api.createEvalRun).mock.calls[1][0].expected_dataset_revision).toBe("b".repeat(64));
  });

  it("retries an interrupted response with the exact same request", async () => {
    vi.mocked(api.createEvalRun).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(await selectDraft());
    const retry = await screen.findByRole("button", { name: "Retry benchmark request" });
    expect(screen.getByRole("button", { name: "Finalize & run benchmark" })).toBeDisabled();
    fireEvent.click(retry);
    await screen.findByText("Runs created: 1");
    expect(api.createEvalRun).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.createEvalRun).mock.calls[1][0]).toEqual(vi.mocked(api.createEvalRun).mock.calls[0][0]);
  });

  describe("across graph versions", () => {
    function mockTwoGraphs() {
      const catalog = vi.mocked(useCatalog)().data as Catalog;
      const twoGraphs = {
        ...catalog,
        agent_systems: [
          {
            ...catalog.agent_systems[0],
            versions: [
              { id: "graph-2", version: 2 },
              { id: "graph-1", version: 1 },
            ],
          },
        ],
      } as unknown as Catalog;
      vi.mocked(useCatalog).mockReturnValue({
        data: twoGraphs,
        loading: false,
        error: null,
        reload,
      });
      vi.mocked(api.agentVersion).mockImplementation(
        async (id) => ({ id, definition: { nodes: [], edges: [] } }) as never,
      );
    }

    async function selectBothGraphs() {
      mockTwoGraphs();
      render(<EvaluationsScreen systemKey="test" />);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Run benchmark" })).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole("combobox", { name: "Graph versions" }));
      fireEvent.click(screen.getByRole("option", { name: "Version 1" }));
      await screen.findByText("1 example × 2 graphs × 1 model");
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Run benchmark" })).toBeEnabled(),
      );
    }

    it("starts one run per version, oldest first, with separate request ids", async () => {
      await selectBothGraphs();
      fireEvent.click(screen.getByRole("button", { name: "Run benchmark" }));
      await screen.findByText("Runs created: 2");
      const calls = vi.mocked(api.createEvalRun).mock.calls.map(([call]) => call);
      expect(calls.map((call) => call.agent_system_version_id)).toEqual([
        "graph-1",
        "graph-2",
      ]);
      expect(calls[0].request_id).not.toBe(calls[1].request_id);
    });

    it("finalizes a draft only on the first request", async () => {
      mockTwoGraphs();
      render(<EvaluationsScreen systemKey="test" />);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Run benchmark" })).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole("combobox", { name: "Graph versions" }));
      fireEvent.click(screen.getByRole("option", { name: "Version 1" }));
      fireEvent.change(screen.getByLabelText("Dataset version"), {
        target: { value: "draft" },
      });
      const button = await screen.findByRole("button", {
        name: "Finalize & run benchmark",
      });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      await screen.findByText("Runs created: 2");
      const calls = vi.mocked(api.createEvalRun).mock.calls.map(([call]) => call);
      expect(calls[0]).toMatchObject({ finalize_dataset: true });
      expect(calls[1]).not.toHaveProperty("finalize_dataset");
    });

    it("retries from the interrupted version without repeating earlier ones", async () => {
      await selectBothGraphs();
      vi.mocked(api.createEvalRun)
        .mockResolvedValueOnce({ ...run, id: "first" })
        .mockRejectedValueOnce(new TypeError("Failed to fetch"));
      fireEvent.click(screen.getByRole("button", { name: "Run benchmark" }));
      const retry = await screen.findByRole("button", {
        name: "Retry benchmark request",
      });
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Graph v2: Failed to fetch",
      );
      fireEvent.click(retry);
      await screen.findByText("Runs created: 2");
      const calls = vi.mocked(api.createEvalRun).mock.calls.map(([call]) => call);
      expect(calls).toHaveLength(3);
      expect(calls[2]).toEqual(calls[1]);
      expect(calls[2].agent_system_version_id).toBe("graph-2");
    });

    it("stops at a rejection and offers no blind retry", async () => {
      await selectBothGraphs();
      vi.mocked(api.createEvalRun)
        .mockResolvedValueOnce({ ...run, id: "first" })
        .mockRejectedValueOnce(new ApiError("Invalid prompt selection", 400));
      fireEvent.click(screen.getByRole("button", { name: "Run benchmark" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Graph v2: Invalid prompt selection",
      );
      await screen.findByText("Runs created: 1");
      expect(
        screen.queryByRole("button", { name: "Retry benchmark request" }),
      ).not.toBeInTheDocument();
    });
  });

  it("keeps empty drafts disabled", async () => {
    details.draft = version("draft", "draft", 2, 0);
    render(<EvaluationsScreen systemKey="test" />);
    fireEvent.change(screen.getByLabelText("Dataset version"), { target: { value: "draft" } });
    await screen.findByText("Add at least one example before starting a benchmark.");
    expect(screen.getByRole("button", { name: "Finalize & run benchmark" })).toBeDisabled();
    expect(api.createEvalRun).not.toHaveBeenCalled();
  });
});
