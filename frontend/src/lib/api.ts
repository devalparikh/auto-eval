import type {
  AgentVersionDetail,
  Catalog,
  CreateCustomModel,
  CustomModel,
  TrainingDataPreview,
  TrainingRuntime,
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

// `||`, not `??`: an empty NEXT_PUBLIC_API_URL is a misconfiguration, not a
// request for the site root. With "" every API path resolves against the app's
// own pages, so /custom-models answers with HTML and /catalog with a 404 page.
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api/backend/api";

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

/**
 * The API, or a proxy in front of it, answered with an error status. Failures
 * where no answer arrived, or the answer was not the API's, are plain `Error`s:
 * callers such as evaluation submission treat those as "the server may have
 * acted" and keep the request for an exact retry.
 */
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

const notJson = Symbol("not JSON");

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...options.headers,
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
    });
  } catch {
    // fetch rejects only when no response arrived at all.
    throw new Error(
      "Could not reach the AutoEval API. Check that the backend is running.",
    );
  }
  const text = await response.text();
  const payload = parseJson(text);
  if (!response.ok) {
    throw new ApiError(
      payload === notJson
        ? unavailableMessage(response.status)
        : requestErrorMessage(payload, response.status),
      response.status,
    );
  }
  if (payload === notJson) {
    // A success that is not JSON came from something other than the API,
    // usually the app's own pages behind a wrong base URL.
    throw new Error(
      `Expected data from the AutoEval API but received ${
        text.trimStart().startsWith("<") ? "a web page" : "plain text"
      }. Check that NEXT_PUBLIC_API_URL points to the backend.`,
    );
  }
  return payload as T;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return notJson;
  }
}

/**
 * The API answers its own errors in JSON, so an error without a JSON body came
 * from a proxy or host in front of it, or from a crash before it could reply.
 */
function unavailableMessage(status: number): string {
  if (status === 404) {
    return `No AutoEval API answered at ${API_URL}. Check that the backend is running and NEXT_PUBLIC_API_URL points to it.`;
  }
  if (status >= 500) {
    return `The AutoEval API failed with HTTP ${status}. Check that the backend is running, then read its logs.`;
  }
  return `The AutoEval API refused the request with HTTP ${status}.`;
}

function requestErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = payload.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      const messages = detail.slice(0, 8).flatMap((item: unknown) => {
        if (
          !item ||
          typeof item !== "object" ||
          !("msg" in item) ||
          typeof item.msg !== "string"
        )
          return [];
        const location =
          "loc" in item && Array.isArray(item.loc)
            ? item.loc
                .filter(
                  (part: unknown) =>
                    typeof part === "string" || typeof part === "number",
                )
                .filter((part) => part !== "body")
                .join(".")
            : "";
        return [location ? `${location}: ${item.msg}` : item.msg];
      });
      if (messages.length) return messages.join("; ");
    }
  }
  return `Request failed with status ${status}`;
}

export const api = {
  customModels: () => apiRequest<CustomModel[]>("/custom-models"),
  trainingRuntime: () => apiRequest<TrainingRuntime>("/custom-models/runtime"),
  previewTraining: (body: CreateCustomModel) =>
    apiRequest<TrainingDataPreview>("/custom-models/preview", { method: "POST", body }),
  createCustomModel: (body: CreateCustomModel) =>
    apiRequest<CustomModel>("/custom-models", { method: "POST", body }),
  updateCustomModel: (id: string, body: { name: string; archived: boolean }) =>
    apiRequest<CustomModel>(`/custom-models/${id}`, { method: "PUT", body }),
  trainCustomModel: (id: string) =>
    apiRequest<CustomModel>(`/custom-models/${id}/train`, { method: "POST" }),
  cancelCustomModel: (id: string) =>
    apiRequest<CustomModel>(`/custom-models/${id}/cancel`, { method: "POST" }),
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
    finalize_dataset?: boolean;
    expected_dataset_revision?: string;
    request_id?: string;
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
