import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateModelModal } from "@/features/custom-models/create-model-modal";
import { api } from "@/lib/api";
import type { Catalog, CustomModel, TrainingRuntime } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  api: { previewTraining: vi.fn(), createCustomModel: vi.fn() },
}));

const catalog: Catalog = {
  agent_systems: [],
  prompts: [],
  models: [],
  datasets: [
    {
      id: "dataset",
      agent_system_id: "system",
      key: "cases",
      name: "Reviewed cases",
      description: "",
      versions: [
        {
          id: "final",
          version: 1,
          status: "final",
          item_count: 10,
          created_at: "2026-01-01",
          finalized_at: "2026-01-01",
        },
        {
          id: "draft",
          version: 2,
          status: "draft",
          item_count: 11,
          created_at: "2026-01-02",
          finalized_at: null,
        },
      ],
    },
  ],
};
const runtime: TrainingRuntime = {
  executor: "local_mlx",
  available: false,
  reason: "Install MLX",
  setup_command: "setup",
  base_models: [{ id: "org/base", label: "Small model", description: "Local" }],
};

function open() {
  const onCreated = vi.fn();
  render(
    <CreateModelModal
      catalog={catalog}
      runtime={runtime}
      source={null}
      onClose={vi.fn()}
      onCreated={onCreated}
    />,
  );
  fireEvent.change(screen.getByLabelText("Model name"), {
    target: { value: "My model" },
  });
  return onCreated;
}

describe("custom model creation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.previewTraining).mockResolvedValue({
      dataset_hash: "a".repeat(64),
      train_count: 9,
      validation_count: 1,
      duplicate_count: 0,
      sample: [
        { role: "user", content: '{"question":"classify"}' },
        { role: "assistant", content: '{"label":"reviewed"}' },
      ],
    });
  });
  afterEach(cleanup);

  it("requires a fresh preview after changing the training recipe", async () => {
    const onCreated = open();
    expect(screen.getByLabelText("Finalized dataset")).toHaveValue("final");
    expect(
      screen.queryByRole("option", { name: /v2/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Review training data" }),
    );
    await waitFor(() =>
      expect(screen.getByText('{"label":"reviewed"}')).toBeVisible(),
    );
    expect(api.createCustomModel).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Training instruction"), {
      target: { value: "Use reviewed labels" },
    });
    expect(screen.queryByText('{"label":"reviewed"}')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Review training data" }),
    );
    const create = await screen.findByRole("button", { name: "Create model" });
    vi.mocked(api.createCustomModel).mockResolvedValue({
      id: "model",
      name: "My model",
    } as CustomModel);
    fireEvent.click(create);
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(api.createCustomModel).toHaveBeenCalledWith(
      expect.objectContaining({
        base_model: "org/base",
        dataset_version_id: "final",
        system_prompt: "Use reviewed labels",
      }),
    );
  });

  it("keeps a reviewed recipe available when saving fails", async () => {
    open();
    fireEvent.click(
      screen.getByRole("button", { name: "Review training data" }),
    );
    const create = await screen.findByRole("button", { name: "Create model" });
    vi.mocked(api.createCustomModel).mockRejectedValue(
      new Error("Dataset has conflicting targets"),
    );
    fireEvent.click(create);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Dataset has conflicting targets",
    );
    await waitFor(() =>
      expect(screen.getByText('{"label":"reviewed"}')).toBeVisible(),
    );
    expect(screen.getByRole("button", { name: "Create model" })).toBeEnabled();
  });
});
