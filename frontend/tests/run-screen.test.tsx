import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunWorkbench } from "@/features/run/run-screen";
import { api } from "@/lib/api";
import type { AgentSystemSummary, Catalog, Trace } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  api: {
    runTrace: vi.fn(),
  },
}));

const system = {
  id: "system-1",
  key: "research-agent",
  name: "Research Agent",
  description: "Answers research questions.",
  versions: [{ id: "graph-2", version: 2, created_at: "2026-08-10T12:00:00Z" }],
  default_model_ids: ["model-default"],
  input_template: { question: "What changed?" },
  dataset_editor: "json",
  primary_metric: "accuracy",
} satisfies AgentSystemSummary;

const catalog = {
  agent_systems: [system],
  prompts: [
    {
      id: "prompt-1",
      agent_system_id: system.id,
      key: "research-agent-prompt",
      name: "Research prompt",
      description: "",
      versions: [
        { id: "prompt-3", version: 3, created_at: "2026-08-10T12:00:00Z" },
      ],
    },
  ],
  datasets: [],
  models: [
    {
      id: "model-default",
      provider: "openrouter",
      label: "Default model",
      supports: ["chat"],
      available: true,
    },
  ],
} satisfies Catalog;

const completedTrace = {
  id: "trace-12345678",
  status: "complete",
  agent_system_id: system.id,
  agent_system_key: system.key,
  agent_system_name: system.name,
  agent_system_version_id: "graph-2",
  prompt_version_id: "prompt-3",
  origin_type: "runtime",
  evaluation_run_id: null,
  evaluation_dataset_item_id: null,
  dataset_membership_count: 0,
  dataset_count: 0,
  dataset_memberships: [],
  model_id: "model-default",
  request_input: { question: "Summarize the change." },
  output: { answer: "The workflow is now system-scoped." },
  error: null,
  latency_ms: 1420,
  cost_usd: 0.0042,
  input_tokens: 120,
  output_tokens: 48,
  started_at: "2026-08-10T12:00:00Z",
  completed_at: "2026-08-10T12:00:01Z",
  graph_definition: null,
  spans: [],
} satisfies Trace;

describe("RunWorkbench", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("runs pinned selections and exposes the resulting persisted trace", async () => {
    vi.mocked(api.runTrace).mockResolvedValueOnce(completedTrace);
    render(
      <RunWorkbench catalog={catalog} system={system} systemKey={system.key} />,
    );

    fireEvent.change(screen.getByLabelText("Request input (JSON)"), {
      target: { value: '{"question":"Summarize the change."}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run inference" }));

    await waitFor(() =>
      expect(api.runTrace).toHaveBeenCalledWith({
        input: { question: "Summarize the change." },
        model_id: "model-default",
        agent_system_id: "system-1",
        agent_system_version_id: "graph-2",
        prompt_version_id: "prompt-3",
      }),
    );
    expect(
      await screen.findByText(/workflow is now system-scoped/),
    ).toBeVisible();
    expect(screen.getByText("168")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Inspect full trace" }),
    ).toHaveAttribute("href", "/systems/research-agent/traces/trace-12345678");
  });

  it("rejects non-object JSON before calling the API", async () => {
    render(
      <RunWorkbench catalog={catalog} system={system} systemKey={system.key} />,
    );
    fireEvent.change(screen.getByLabelText("Request input (JSON)"), {
      target: { value: "[]" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run inference" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("JSON object");
    expect(api.runTrace).not.toHaveBeenCalled();
  });
});
