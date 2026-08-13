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
    nodeSnapshots: vi.fn(),
    runTrace: vi.fn(),
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
    agent_system_key: portfolioProduct.key,
    product_key: "portfolio-analyst",
    flow_key: "index",
    flow_name: "Index portfolio",
    source_trace_id: null,
    node_id: "persist_portfolio_snapshot",
    node_label: "Persist immutable portfolio snapshot",
    node_kind: "deterministic" as const,
    output_key: "portfolio_state",
    resource_identity: "main_synthetic_portfolio",
    snapshot_kind: "state" as const,
    schema_version: 1,
    label: "Older synthetic portfolio",
    observed_at: "2026-08-09T12:00:00Z",
    captured_at: "2026-08-09T12:00:00Z",
    source: "synthetic",
    provider: null,
    capture_mode: "seeded" as const,
    is_synthetic: true,
    content_hash: "a".repeat(64),
    usage_count: 0,
    latest_usage: null,
  },
  {
    id: "snapshot-2",
    agent_system_id: portfolioProduct.id,
    agent_system_key: portfolioProduct.key,
    product_key: "portfolio-analyst",
    flow_key: "index",
    flow_name: "Index portfolio",
    source_trace_id: null,
    node_id: "persist_portfolio_snapshot",
    node_label: "Persist immutable portfolio snapshot",
    node_kind: "deterministic" as const,
    output_key: "portfolio_state",
    resource_identity: "main_synthetic_portfolio",
    snapshot_kind: "state" as const,
    schema_version: 1,
    label: "Current synthetic portfolio",
    observed_at: "2026-08-10T12:00:00Z",
    captured_at: "2026-08-10T12:00:00Z",
    source: "synthetic",
    provider: null,
    capture_mode: "seeded" as const,
    is_synthetic: true,
    content_hash: "b".repeat(64),
    usage_count: 0,
    latest_usage: null,
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

const portfolioQueryGraph = {
  ...legacyGraph,
  agent_system_id: portfolioQuerySystem.id,
  definition: {
    entry_point: "get_indexed_portfolio",
    output_node: "answer",
    nodes: [
      {
        id: "get_indexed_portfolio",
        label: "Get indexed portfolio",
        kind: "deterministic" as const,
        handler: "get_indexed_portfolio",
        task: null,
        resource_policy: {
          product_key: "portfolio-analyst",
          resource_key: "indexed_portfolio",
          producer_system_key: "portfolio-analyst",
          producer_node_id: "persist_portfolio_snapshot",
          producer_output_key: "portfolio_state",
          producer_snapshot_kind: "state" as const,
          schema_version: 1,
          runtime_mode: "current" as const,
          evaluation_mode: "locked" as const,
          required: true,
        },
      },
      {
        id: "load_options",
        label: "Load current options",
        kind: "deterministic" as const,
        handler: "load_options",
        task: null,
        runtime_input_policy: {
          source: "options_chain",
          schema_version: 1,
          required: false,
          runtime_mode: "refresh" as const,
          evaluation_mode: "locked" as const,
        },
        snapshot_policy: {
          output_key: "options_chain",
          snapshot_kind: "external_observation" as const,
          schema_version: 1,
          binding_mode: "produce_or_consume" as const,
          reveal_policy_key: "external_observation",
          required: false,
        },
      },
      legacyGraph.definition.nodes[0],
    ],
    edges: [
      { source: "get_indexed_portfolio", target: "load_options" },
      { source: "load_options", target: "answer" },
    ],
  },
};

describe("RunWorkbench", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.agentVersion).mockResolvedValue(legacyGraph);
    vi.mocked(api.nodeSnapshots).mockResolvedValue([]);
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
        node_resource_selections: {},
        capture_node_outputs: false,
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

  it("binds a current identity or exact snapshot without changing business input", async () => {
    vi.mocked(api.agentVersion).mockResolvedValueOnce(portfolioQueryGraph);
    vi.mocked(api.nodeSnapshots).mockResolvedValue(portfolioSnapshots);
    vi.mocked(api.runTrace).mockResolvedValueOnce({
      ...completedTrace,
      agent_system_id: portfolioQuerySystem.id,
      agent_system_key: portfolioQuerySystem.key,
      agent_system_name: portfolioQuerySystem.name,
      request_input: { question: "Which call fits?" },
    });
    render(
      <RunWorkbench
        catalog={portfolioQueryCatalog}
        system={portfolioQuerySystem}
        systemKey={portfolioQuerySystem.key}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run inference" }),
      ).toBeEnabled(),
    );
    expect(api.nodeSnapshots).toHaveBeenCalledWith({
      productKey: "portfolio-analyst",
      agentSystemKey: "portfolio-analyst",
      nodeId: "persist_portfolio_snapshot",
      outputKey: "portfolio_state",
      schemaVersion: 1,
      snapshotKind: "state",
      latestPerIdentity: true,
      limit: 500,
    });
    await waitFor(() =>
      expect(api.nodeSnapshots).toHaveBeenCalledWith({
        productKey: "portfolio-analyst",
        agentSystemKey: "portfolio-analyst",
        nodeId: "persist_portfolio_snapshot",
        outputKey: "portfolio_state",
        schemaVersion: 1,
        snapshotKind: "state",
        resourceIdentity: "main_synthetic_portfolio",
        limit: 500,
      }),
    );
    const resource = screen.getByLabelText("Resource version");
    expect(resource).toHaveValue("current:main_synthetic_portfolio");
    expect(screen.getByText("deterministic current resource")).toBeVisible();
    const capture = screen.getByRole("checkbox", {
      name: /Capture refreshed external outputs/,
    });
    expect(capture).not.toBeChecked();

    const advancedInput = screen.getByLabelText("Advanced query input (JSON)");
    expect((advancedInput as HTMLTextAreaElement).value).not.toContain(
      "snapshot_id",
    );
    expect((advancedInput as HTMLTextAreaElement).value).not.toContain(
      "market_context",
    );
    expect(
      screen.getByRole("option", { name: /Locked · Current synthetic portfolio/ }),
    ).toHaveValue("locked:snapshot-2");
    fireEvent.change(resource, { target: { value: "locked:snapshot-2" } });
    expect(await screen.findByText("snapshot replay")).toBeVisible();
    fireEvent.change(advancedInput, {
      target: {
        value: JSON.stringify({
          question: "Which call fits?",
          policy: { min_dte: 21 },
        }),
      },
    });
    fireEvent.click(capture);
    fireEvent.click(screen.getByRole("button", { name: "Run inference" }));

    await waitFor(() =>
      expect(api.runTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          agent_system_id: portfolioQuerySystem.id,
          input: {
            question: "Which call fits?",
            policy: { min_dte: 21 },
          },
          node_resource_selections: {
            get_indexed_portfolio: {
              mode: "locked",
              snapshot_id: "snapshot-2",
            },
          },
          capture_node_outputs: true,
        }),
      ),
    );
  });

  it("disables a graph when its required resource has no snapshots", async () => {
    vi.mocked(api.agentVersion).mockResolvedValueOnce(portfolioQueryGraph);
    render(
      <RunWorkbench
        catalog={portfolioQueryCatalog}
        system={portfolioQuerySystem}
        systemKey={portfolioQuerySystem.key}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Index or seed the required indexed_portfolio resource",
    );
    expect(
      screen.getByRole("button", { name: "Run inference" }),
    ).toBeDisabled();
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
});
