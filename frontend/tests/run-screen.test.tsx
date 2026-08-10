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
    agentVersion: vi.fn(),
    runTrace: vi.fn(),
    createInputSample: vi.fn(),
  },
}));

const system = {
  id: "system-1",
  key: "research-agent",
  product_key: "research-agent",
  flow_key: "run",
  flow_name: "Run",
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

const portfolioProduct = {
  ...system,
  id: "portfolio-product",
  key: "portfolio-analyst",
  product_key: "portfolio-analyst",
  flow_key: "index",
  flow_name: "Index portfolio",
  name: "Portfolio Analyst",
} satisfies AgentSystemSummary;

const portfolioQuerySystem = {
  ...system,
  id: "portfolio-query-system",
  key: "portfolio-query",
  product_key: "portfolio-analyst",
  flow_key: "query",
  flow_name: "Query portfolio",
  name: "Investment Portfolio Q&A",
  input_template: {
    snapshot_id: "snapshot-2",
    question: "Which covered call fits?",
    market_context: { contracts: [] },
    policy: { min_dte: 21 },
  },
} satisfies AgentSystemSummary;

const portfolioQueryCatalog = {
  ...catalog,
  agent_systems: [portfolioProduct, portfolioQuerySystem],
  prompts: [
    {
      ...catalog.prompts[0],
      agent_system_id: portfolioQuerySystem.id,
    },
  ],
} satisfies Catalog;

const portfolioSnapshots = [
  {
    id: "snapshot-1",
    agent_system_id: portfolioProduct.id,
    source_trace_id: null,
    schema_version: 1,
    label: "Older synthetic portfolio",
    as_of: "2026-08-09T12:00:00Z",
    source_kind: "synthetic",
    is_synthetic: true,
    content_hash: "a".repeat(64),
    position_count: 3,
    created_at: "2026-08-09T12:00:00Z",
  },
  {
    id: "snapshot-2",
    agent_system_id: portfolioProduct.id,
    source_trace_id: null,
    schema_version: 1,
    label: "Current synthetic portfolio",
    as_of: "2026-08-10T12:00:00Z",
    source_kind: "synthetic",
    is_synthetic: true,
    content_hash: "b".repeat(64),
    position_count: 4,
    created_at: "2026-08-10T12:00:00Z",
  },
];

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

const legacyGraph = {
  id: "graph-2",
  agent_system_id: system.id,
  version: 2,
  content_hash: "graph-hash",
  created_at: "2026-08-10T12:00:00Z",
  definition: {
    entry_point: "answer",
    output_node: "answer",
    nodes: [
      {
        id: "answer",
        label: "Answer",
        kind: "llm" as const,
        handler: "answer",
        task: "answer",
      },
    ],
    edges: [],
  },
};

describe("RunWorkbench", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.agentVersion).mockResolvedValue(legacyGraph);
  });

  afterEach(() => {
    cleanup();
  });

  it("runs pinned selections and exposes the resulting persisted trace", async () => {
    vi.mocked(api.runTrace).mockResolvedValueOnce(completedTrace);
    render(
      <RunWorkbench catalog={catalog} system={system} systemKey={system.key} />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run inference" }),
      ).toBeEnabled(),
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
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run inference" }),
      ).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("Request input (JSON)"), {
      target: { value: "[]" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run inference" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("JSON object");
    expect(api.runTrace).not.toHaveBeenCalled();
  });

  it("resolves a selected portfolio snapshot by ID while keeping advanced input editable", async () => {
    vi.mocked(api.runTrace).mockResolvedValueOnce({
      ...completedTrace,
      agent_system_id: portfolioQuerySystem.id,
      agent_system_key: portfolioQuerySystem.key,
      agent_system_name: portfolioQuerySystem.name,
      request_input: {
        snapshot_id: "snapshot-2",
        question: "Which call fits?",
      },
    });
    render(
      <RunWorkbench
        catalog={portfolioQueryCatalog}
        system={portfolioQuerySystem}
        systemKey={portfolioQuerySystem.key}
        portfolioSnapshots={portfolioSnapshots}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run inference" }),
      ).toBeEnabled(),
    );

    expect(
      screen.getByRole("heading", {
        name: "Portfolio Analyst · Query portfolio",
      }),
    ).toBeVisible();
    expect(screen.getByLabelText("Indexed snapshot")).toHaveValue("snapshot-2");
    expect(
      screen.getByText(/referenced by ID and resolved server-side/i),
    ).toBeVisible();
    const advancedInput = screen.getByLabelText("Advanced query input (JSON)");
    expect((advancedInput as HTMLTextAreaElement).value).not.toContain(
      "snapshot_id",
    );
    expect((advancedInput as HTMLTextAreaElement).value).not.toContain(
      "market_context",
    );
    fireEvent.change(advancedInput, {
      target: {
        value: JSON.stringify({
          question: "Which call fits?",
          market_context: { contracts: [] },
          policy: { min_dte: 21 },
        }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run inference" }));

    await waitFor(() =>
      expect(api.runTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          agent_system_id: portfolioQuerySystem.id,
          input: {
            snapshot_id: "snapshot-2",
            question: "Which call fits?",
            policy: { min_dte: 21 },
          },
        }),
      ),
    );
  });

  it("disables portfolio queries when no indexed snapshots exist", () => {
    render(
      <RunWorkbench
        catalog={portfolioQueryCatalog}
        system={portfolioQuerySystem}
        systemKey={portfolioQuerySystem.key}
        portfolioSnapshots={[]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Run inference" }),
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Seed or index a portfolio snapshot",
    );
  });

  it("pins one prompt version per graph prompt key", async () => {
    const keyedCatalog = {
      ...catalog,
      prompts: [
        catalog.prompts[0],
        {
          ...catalog.prompts[0],
          id: "prompt-2",
          key: "review-prompt",
          name: "Review prompt",
          versions: [
            {
              id: "prompt-8",
              version: 8,
              created_at: "2026-08-10T12:00:00Z",
            },
          ],
        },
      ],
    } satisfies Catalog;
    vi.mocked(api.agentVersion).mockResolvedValueOnce({
      ...legacyGraph,
      definition: {
        ...legacyGraph.definition,
        nodes: [
          {
            ...legacyGraph.definition.nodes[0],
            prompt_key: "research-agent-prompt",
          },
          {
            id: "review",
            label: "Review",
            kind: "llm",
            handler: "review",
            task: "review",
            prompt_key: "review-prompt",
          },
        ],
        edges: [{ source: "answer", target: "review" }],
        output_node: "review",
      },
    });
    vi.mocked(api.runTrace).mockResolvedValueOnce(completedTrace);
    render(
      <RunWorkbench
        catalog={keyedCatalog}
        system={system}
        systemKey={system.key}
      />,
    );

    expect(
      await screen.findByLabelText("Prompt · research-agent-prompt"),
    ).toHaveValue("prompt-3");
    expect(screen.getByLabelText("Prompt · review-prompt")).toHaveValue(
      "prompt-8",
    );
    fireEvent.click(screen.getByRole("button", { name: "Run inference" }));

    await waitFor(() =>
      expect(api.runTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt_version_id: "prompt-3",
          prompt_version_ids: {
            "research-agent-prompt": "prompt-3",
            "review-prompt": "prompt-8",
          },
        }),
      ),
    );
  });

  it("saves an opted-in input only after the trace is recorded", async () => {
    vi.mocked(api.runTrace).mockResolvedValueOnce(completedTrace);
    vi.mocked(api.createInputSample).mockResolvedValueOnce({
      id: "sample-1",
      agent_system_id: system.id,
      source_trace_id: completedTrace.id,
      input: { question: "Summarize the change." },
      created_at: "2026-08-10T12:00:02Z",
    });
    render(
      <RunWorkbench catalog={catalog} system={system} systemKey={system.key} />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run inference" }),
      ).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("Request input (JSON)"), {
      target: { value: '{"question":"Summarize the change."}' },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Save input as sample/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Run inference" }));

    expect(await screen.findByText(/Input saved as sample/)).toBeVisible();
    expect(api.createInputSample).toHaveBeenCalledWith(system.id, {
      input: { question: "Summarize the change." },
      source_trace_id: completedTrace.id,
    });
    expect(vi.mocked(api.runTrace).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.createInputSample).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("keeps the recorded trace visible when sample saving fails", async () => {
    vi.mocked(api.runTrace).mockResolvedValueOnce(completedTrace);
    vi.mocked(api.createInputSample).mockRejectedValueOnce(
      new Error("Sample storage unavailable"),
    );
    render(
      <RunWorkbench catalog={catalog} system={system} systemKey={system.key} />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run inference" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Save input as sample/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Run inference" }));

    expect(
      await screen.findByText(/Trace recorded, but the input sample/),
    ).toHaveTextContent("Sample storage unavailable");
    expect(
      screen.getByRole("link", { name: "Inspect full trace" }),
    ).toBeVisible();
  });

  it("does not try to save a sample for a failed trace", async () => {
    vi.mocked(api.runTrace).mockResolvedValueOnce({
      ...completedTrace,
      status: "failed",
      error: "Provider unavailable",
      output: null,
    });
    render(
      <RunWorkbench catalog={catalog} system={system} systemKey={system.key} />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run inference" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Save input as sample/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Run inference" }));

    expect(await screen.findByText(/Input sample skipped/)).toBeVisible();
    expect(api.createInputSample).not.toHaveBeenCalled();
    expect(screen.getByText("Provider unavailable")).toBeVisible();
  });
});
