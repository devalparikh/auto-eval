import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportScreen } from "@/features/systems/import-screen";
import { importApi, type ImportPreview } from "@/features/systems/import-api";
import { starterManifest } from "@/features/systems/import-starter";

vi.mock("@/features/systems/import-api", () => ({
  importApi: {
    inspectManifest: vi.fn(),
    inspectGithub: vi.fn(),
    commit: vi.fn(),
  },
}));
vi.mock("@/features/systems/agent-graph", () => ({
  AgentGraph: () => <div>Graph preview</div>,
  isGraphDefinition: () => true,
}));
vi.mock("@/lib/use-catalog", () => ({
  useCatalog: () => ({ reload: vi.fn(async () => undefined) }),
}));

const preview = {
  digest: "a".repeat(64),
  manifest: starterManifest,
  source: { kind: "local" },
  warnings: [],
  existing_system_id: null,
  next_graph_version: 1,
  next_prompt_version: 1,
  target_graph_version: 1,
  target_prompt_version: 1,
  graph_version_created: true,
  prompt_version_created: true,
  creates_system: true,
  counts: { nodes: 3, edges: 2, llm_nodes: 1, deterministic_nodes: 2 },
  compatibility: {
    runnable: true,
    evaluation_scoring: "exact_json",
    handlers: [],
  },
} as ImportPreview;

describe("ImportScreen", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(importApi.inspectManifest).mockResolvedValue(preview);
  });
  afterEach(cleanup);

  it("requires review before commit and submits the inspected version expectations", async () => {
    render(<ImportScreen />);
    fireEvent.click(
      screen.getByRole("button", { name: /Try a runnable example/ }),
    );
    expect(await screen.findByText("Graph preview")).toBeVisible();
    expect(importApi.commit).not.toHaveBeenCalled();
    vi.mocked(importApi.commit).mockResolvedValue({
      agent_system_id: "new-system",
      graph_version_id: "g1",
      graph_version: 1,
      graph_version_created: true,
      prompt_id: "p",
      prompt_version_id: "p1",
      prompt_version: 1,
      prompt_version_created: true,
      dataset_id: "d",
      dataset_version_id: "d1",
      created_system: true,
      digest: preview.digest,
    });
    fireEvent.click(screen.getByRole("button", { name: "Import system" }));
    await waitFor(() =>
      expect(importApi.commit).toHaveBeenCalledWith(
        expect.objectContaining({
          manifest: preview.manifest,
          expected_digest: preview.digest,
          expected_system_key: "support-summary",
          expected_system_id: null,
          expected_graph_version: 1,
          expected_prompt_version: 1,
        }),
      ),
    );
    expect(
      await screen.findByRole("link", { name: /Run this agent/ }),
    ).toHaveAttribute(
      "href",
      "/systems/support-summary/run?graphVersion=g1&promptVersion=p1",
    );
  });

  it("blocks importing a different system in the version flow", async () => {
    render(<ImportScreen systemKey="another-system" />);
    fireEvent.click(screen.getByRole("button", { name: "Paste manifest" }));
    fireEvent.change(screen.getByLabelText("autoeval.json"), {
      target: { value: JSON.stringify(starterManifest) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review manifest" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Use the system key another-system",
    );
    expect(importApi.commit).not.toHaveBeenCalled();
  });

  it("keeps the review available when commit fails", async () => {
    vi.mocked(importApi.commit).mockRejectedValue(
      new Error("Version history changed. Inspect again."),
    );
    render(<ImportScreen />);
    fireEvent.click(
      screen.getByRole("button", { name: /Try a runnable example/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Import system" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Version history changed",
    );
    expect(screen.getByText("Graph preview")).toBeVisible();
    expect(screen.getByRole("button", { name: "Change source" })).toBeEnabled();
  });

  it("provides a next step when a folder has no manifest", async () => {
    render(<ImportScreen />);
    fireEvent.change(screen.getByLabelText("Agent folder"), {
      target: { files: [new File(["test"], "agent.py")] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No autoeval.json found",
    );
    expect(
      screen.getByRole("link", { name: "Open the setup guide" }),
    ).toHaveAttribute("href", "/guide");
    expect(importApi.inspectManifest).not.toHaveBeenCalled();
  });
});
