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
import type {
  AgentSystemSummary,
  Catalog,
  RuntimeInputSnapshotSummary,
  Trace,
} from "@/lib/types";

vi.mock("@/lib/api", () => ({
  api: {
    agentVersion: vi.fn(),
    nodeSnapshots: vi.fn(),
    promptVersion: vi.fn(),
    runtimeInputSnapshots: vi.fn(),
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

const optionsSnapshots = [
  {
    id: "runtime-2",
    agent_system_id: portfolioQuerySystem.id,
    source_trace_id: null,
    node_id: "load_options",
    source_key: "options_chain",
    schema_version: 1,
    label: "Options chain, Aug 10",
    observed_at: "2026-08-10T12:00:00Z",
    fetched_at: "2026-08-10T12:00:00Z",
    provider: "synthetic",
    source_kind: "options_chain",
    is_synthetic: true,
    content_hash: "c".repeat(64),
    created_at: "2026-08-10T12:00:00Z",
  },
  {
    id: "runtime-1",
    agent_system_id: portfolioQuerySystem.id,
    source_trace_id: null,
    node_id: "load_options",
    source_key: "options_chain",
    schema_version: 1,
    label: "Options chain, Aug 9",
    observed_at: "2026-08-09T12:00:00Z",
    fetched_at: "2026-08-09T12:00:00Z",
    provider: "synthetic",
    source_kind: "options_chain",
    is_synthetic: true,
    content_hash: "d".repeat(64),
    created_at: "2026-08-09T12:00:00Z",
  },
] satisfies RuntimeInputSnapshotSummary[];

function lockedMarketGraph(required: boolean) {
  return {
    ...portfolioQueryGraph,
    definition: {
      ...portfolioQueryGraph.definition,
      nodes: [
        portfolioQueryGraph.definition.nodes[0],
        {
          ...portfolioQueryGraph.definition.nodes[1],
          runtime_input_policy: {
            source: "options_chain",
            schema_version: 1,
            required,
            runtime_mode: "locked" as const,
            evaluation_mode: "locked" as const,
          },
        },
        portfolioQueryGraph.definition.nodes[2],
      ],
    },
  };
}

describe("RunWorkbench", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.agentVersion).mockResolvedValue(legacyGraph);
    vi.mocked(api.nodeSnapshots).mockResolvedValue([]);
    vi.mocked(api.runtimeInputSnapshots).mockResolvedValue([]);
    vi.mocked(api.promptVersion).mockResolvedValue({
      id: "prompt-3",
      prompt_id: "prompt-1",
      version: 3,
      content: "Answer the question.",
      content_hash: "e".repeat(64),
      created_at: "2026-08-10T12:00:00Z",
    });
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

  it("keeps the graph preview mounted while a new version loads", async () => {
    const olderGraph = {
      ...legacyGraph,
      id: "graph-1",
      version: 1,
      content_hash: "older-graph-hash",
    };
    const versionedSystem = {
      ...system,
      versions: [
        ...system.versions,
        { id: "graph-1", version: 1, created_at: "2026-08-09T12:00:00Z" },
      ],
    } satisfies AgentSystemSummary;
    const versionedCatalog = {
      ...catalog,
      agent_systems: [versionedSystem],
    } satisfies Catalog;
    let resolveOlderGraph: ((graph: typeof olderGraph) => void) | undefined;
    const olderGraphRequest = new Promise<typeof olderGraph>((resolve) => {
      resolveOlderGraph = resolve;
    });
    vi.mocked(api.agentVersion).mockImplementation((versionId) =>
      versionId === olderGraph.id
        ? olderGraphRequest
        : Promise.resolve(legacyGraph),
    );

    render(
      <RunWorkbench
        catalog={versionedCatalog}
        system={versionedSystem}
        systemKey={versionedSystem.key}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run inference" }),
      ).toBeEnabled(),
    );
    const preview = screen.getByLabelText("Selected graph execution preview");

    fireEvent.change(screen.getByLabelText("Graph version"), {
      target: { value: olderGraph.id },
    });

    expect(
      screen.getByRole("button", { name: "Run inference" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Selected graph execution preview")).toBe(
      preview,
    );
    expect(await screen.findByText("Loading graph v1…")).toBeVisible();

    resolveOlderGraph?.(olderGraph);

    await waitFor(() =>
      expect(screen.queryByText("Loading graph v1…")).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Selected graph execution preview")).toBe(
      preview,
    );
    expect(screen.getByRole("button", { name: "Run inference" })).toBeEnabled();
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
    const resource = screen.getByLabelText("Saved input version");
    expect(resource).toHaveValue("current:main_synthetic_portfolio");
    expect(screen.getByText("Uses the newest saved version.")).toBeVisible();
    const capture = screen.getByRole("checkbox", {
      name: /Keep a copy of live data/,
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
      screen.getByRole("option", {
        name: /Exact version: Current synthetic portfolio/,
      }),
    ).toHaveValue("locked:snapshot-2");
    fireEvent.change(resource, { target: { value: "locked:snapshot-2" } });
    expect(
      await screen.findByText("Uses one exact saved version."),
    ).toBeVisible();
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
      "This graph needs a saved indexed_portfolio input",
    );
    expect(
      screen.getByRole("button", { name: "Run inference" }),
    ).toBeDisabled();
  });

  it("pins one prompt version per model node", async () => {
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
              id: "prompt-9",
              version: 9,
              created_at: "2026-08-11T12:00:00Z",
            },
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

    // Every prompt version is readable without opening a node.
    const reviewPlanItem = await screen.findByRole("button", {
      name: "Review prompt Version 9",
    });
    expect(
      screen.getByRole("button", { name: "Research prompt Version 3" }),
    ).toBeVisible();
    expect(
      screen.getByLabelText("Prompt version for Research prompt"),
    ).toHaveValue("prompt-3");
    expect(
      screen.queryByLabelText("Prompt version for Review prompt"),
    ).not.toBeInTheDocument();

    fireEvent.click(reviewPlanItem);
    fireEvent.change(
      await screen.findByLabelText("Prompt version for Review prompt"),
      { target: { value: "prompt-8" } },
    );
    expect(
      await screen.findByRole("button", { name: "Review prompt Version 8" }),
    ).toBeVisible();
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

  it("replays a chosen saved copy for a locked live-data node", async () => {
    vi.mocked(api.agentVersion).mockResolvedValueOnce(lockedMarketGraph(false));
    vi.mocked(api.nodeSnapshots).mockResolvedValue(portfolioSnapshots);
    vi.mocked(api.runtimeInputSnapshots).mockResolvedValue(optionsSnapshots);
    vi.mocked(api.runTrace).mockResolvedValueOnce(completedTrace);
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
    expect(api.runtimeInputSnapshots).toHaveBeenCalledWith(
      portfolioQuerySystem.id,
      { sourceKey: "options_chain", nodeId: "load_options", limit: 200 },
    );

    // The newest saved copy is used unless the reader picks another.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Load current options Options chain, Aug 10",
      }),
    );
    const picker = await screen.findByLabelText("Saved copy to use");
    expect(picker).toHaveValue("runtime-2");
    fireEvent.change(picker, { target: { value: "runtime-1" } });
    expect(
      await screen.findByRole("button", {
        name: "Load current options Options chain, Aug 9",
      }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Run inference" }));
    await waitFor(() =>
      expect(api.runTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime_input_snapshot_ids: { load_options: "runtime-1" },
        }),
      ),
    );
  });

  it("blocks a run when a required locked live-data node has nothing saved", async () => {
    vi.mocked(api.agentVersion).mockResolvedValueOnce(lockedMarketGraph(true));
    vi.mocked(api.nodeSnapshots).mockResolvedValue(portfolioSnapshots);
    vi.mocked(api.runtimeInputSnapshots).mockResolvedValue([]);
    render(
      <RunWorkbench
        catalog={portfolioQueryCatalog}
        system={portfolioQuerySystem}
        systemKey={portfolioQuerySystem.key}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "This graph reads a saved copy of options chain instead of fetching it, and nothing has been saved yet.",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Run inference" }),
    ).toBeDisabled();
  });
});
