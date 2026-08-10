import type {
  AgentVersionDetail,
  Catalog,
  DatasetItem,
  DatasetVersionDetail,
  EvalRun,
  InputSample,
  PortfolioSnapshotDetail,
  PortfolioSnapshotSummary,
  PromptVersionDetail,
  Trace,
  TraceDatasetTargets,
} from "@/lib/types";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

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
  }) => apiRequest<Trace>("/traces/run", { method: "POST", body: payload }),
  createInputSample: (
    agentSystemId: string,
    payload: {
      input: Record<string, unknown>;
      source_trace_id: string;
    },
  ) =>
    apiRequest<InputSample>(`/agent-systems/${agentSystemId}/input-samples`, {
      method: "POST",
      body: payload,
    }),
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
