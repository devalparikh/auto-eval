import type {
  AgentVersionDetail,
  Catalog,
  DatasetItem,
  DatasetVersionDetail,
  EvalRun,
  NodeResourceSelection,
  NodeSnapshotDetail,
  NodeSnapshotSummary,
  PortfolioSnapshotDetail,
  PortfolioSnapshotSummary,
  PromptVersionDetail,
  RuntimeInputSnapshotDetail,
  RuntimeInputSnapshotSummary,
  Trace,
  TraceDatasetTargets,
} from "@/lib/types";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "/api/backend/api";

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      detail?: string;
    } | null;
    throw new Error(
      payload?.detail ?? `Request failed with status ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}

export const api = {
  catalog: () => apiRequest<Catalog>("/catalog"),
  portfolioSnapshots: (agentSystemKey?: string, syntheticOnly = false) => {
    const params = new URLSearchParams();
    if (agentSystemKey) params.set("agent_system_key", agentSystemKey);
    if (syntheticOnly) params.set("synthetic_only", "true");
    const query = params.size ? `?${params.toString()}` : "";
    return apiRequest<PortfolioSnapshotSummary[]>(
      `/portfolio-snapshots${query}`,
    );
  },
  portfolioSnapshot: (snapshotId: string) =>
    apiRequest<PortfolioSnapshotDetail>(`/portfolio-snapshots/${snapshotId}`),
  runtimeInputSnapshots: (
    agentSystemId: string,
    filters: {
      sourceKey?: string;
      nodeId?: string;
      syntheticOnly?: boolean;
      limit?: number;
    } = {},
  ) => {
    const params = new URLSearchParams();
    if (filters.sourceKey) params.set("source_key", filters.sourceKey);
    if (filters.nodeId) params.set("node_id", filters.nodeId);
    if (filters.syntheticOnly) params.set("synthetic_only", "true");
    if (filters.limit) params.set("limit", String(filters.limit));
    const query = params.size ? `?${params.toString()}` : "";
    return apiRequest<RuntimeInputSnapshotSummary[]>(
      `/agent-systems/${agentSystemId}/runtime-input-snapshots${query}`,
    );
  },
  runtimeInputSnapshot: (snapshotId: string) =>
    apiRequest<RuntimeInputSnapshotDetail>(
      `/runtime-input-snapshots/${snapshotId}`,
    ),
  nodeSnapshots: (filters: {
    productKey?: string;
    agentSystemId?: string;
    agentSystemKey?: string;
    nodeId?: string;
    outputKey?: string;
    schemaVersion?: number;
    snapshotKind?: "state" | "external_observation" | "node_output";
    resourceIdentity?: string;
    latestPerIdentity?: boolean;
    limit?: number;
  }) => {
    const params = new URLSearchParams();
    if (filters.productKey) params.set("product_key", filters.productKey);
    if (filters.agentSystemId)
      params.set("agent_system_id", filters.agentSystemId);
    if (filters.agentSystemKey)
      params.set("agent_system_key", filters.agentSystemKey);
    if (filters.nodeId) params.set("node_id", filters.nodeId);
    if (filters.outputKey) params.set("output_key", filters.outputKey);
    if (filters.schemaVersion)
      params.set("schema_version", String(filters.schemaVersion));
    if (filters.snapshotKind) params.set("snapshot_kind", filters.snapshotKind);
    if (filters.resourceIdentity)
      params.set("resource_identity", filters.resourceIdentity);
    if (filters.latestPerIdentity) params.set("latest_per_identity", "true");
    if (filters.limit) params.set("limit", String(filters.limit));
    return apiRequest<NodeSnapshotSummary[]>(
      `/node-snapshots?${params.toString()}`,
    );
  },
  nodeSnapshot: (snapshotId: string) =>
    apiRequest<NodeSnapshotDetail>(`/node-snapshots/${snapshotId}`),
  traces: (agentSystemId?: string) =>
    apiRequest<Trace[]>(
      `/traces${agentSystemId ? `?agent_system_id=${encodeURIComponent(agentSystemId)}` : ""}`,
    ),
  trace: (traceId: string) => apiRequest<Trace>(`/traces/${traceId}`),
  traceDatasetTargets: (traceId: string) =>
    apiRequest<TraceDatasetTargets>(`/traces/${traceId}/dataset-targets`),
  runTrace: (payload: {
    input: Record<string, unknown>;
    model_id: string;
    agent_system_id?: string;
    agent_system_version_id?: string;
    prompt_version_id?: string;
    prompt_version_ids?: Record<string, string>;
    node_resource_selections?: Record<string, NodeResourceSelection>;
    capture_node_outputs?: boolean;
  }) => apiRequest<Trace>("/traces/run", { method: "POST", body: payload }),
  datasetVersion: (versionId: string) =>
    apiRequest<DatasetVersionDetail>(`/dataset-versions/${versionId}`),
  addDatasetItemFromTrace: (
    versionId: string,
    traceId: string,
    payload: {
      expected: Record<string, unknown>;
    },
  ) =>
    apiRequest<DatasetItem>(
      `/dataset-versions/${versionId}/trace-items/${traceId}`,
      {
        method: "PUT",
        body: payload,
      },
    ),
  updateDatasetItem: (
    itemId: string,
    payload: {
      input?: Record<string, unknown>;
      expected: Record<string, unknown>;
    },
  ) =>
    apiRequest<DatasetItem>(`/dataset-items/${itemId}`, {
      method: "PUT",
      body: payload,
    }),
  finalizeDataset: (versionId: string) =>
    apiRequest<DatasetVersionDetail>(
      `/dataset-versions/${versionId}/finalize`,
      {
        method: "POST",
      },
    ),
  createDatasetVersion: (datasetId: string, cloneFromVersionId?: string) =>
    apiRequest<DatasetVersionDetail>(`/datasets/${datasetId}/versions`, {
      method: "POST",
      body: { clone_from_version_id: cloneFromVersionId ?? null },
    }),
  evalRuns: (query = "") => apiRequest<EvalRun[]>(`/eval-runs${query}`),
  evalRun: (runId: string) => apiRequest<EvalRun>(`/eval-runs/${runId}`),
  createEvalRun: (payload: {
    dataset_version_id: string;
    model_ids: string[];
    agent_system_version_id?: string;
    prompt_version_id?: string;
    prompt_version_ids?: Record<string, string>;
  }) => apiRequest<EvalRun>("/eval-runs", { method: "POST", body: payload }),
  agentVersion: (versionId: string) =>
    apiRequest<AgentVersionDetail>(`/agent-system-versions/${versionId}`),
  promptVersion: (versionId: string) =>
    apiRequest<PromptVersionDetail>(`/prompt-versions/${versionId}`),
  createAgentVersion: (
    agentSystemId: string,
    definition: Record<string, unknown>,
  ) =>
    apiRequest<AgentVersionDetail>(`/agent-systems/${agentSystemId}/versions`, {
      method: "POST",
      body: { definition },
    }),
  createPromptVersion: (promptId: string, content: string) =>
    apiRequest<PromptVersionDetail>(`/prompts/${promptId}/versions`, {
      method: "POST",
      body: { content },
    }),
};
