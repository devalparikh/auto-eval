export type VersionSummary = {
  id: string;
  version: number;
  content_hash?: string | null;
  created_at: string;
};

export type AgentSystemSummary = {
  id: string;
  key: string;
  product_key: string;
  flow_key: string;
  flow_name: string;
  name: string;
  description: string;
  versions: VersionSummary[];
  default_model_ids: string[];
  input_template: Record<string, unknown>;
  dataset_editor: string;
  input_editor: string;
  primary_metric: string;
};

export type PromptSummary = {
  id: string;
  agent_system_id: string;
  key: string;
  name: string;
  description: string;
  versions: VersionSummary[];
};

export type DatasetVersionSummary = {
  id: string;
  version: number;
  status: "draft" | "final";
  item_count: number;
  created_at: string;
  finalized_at: string | null;
};

export type DatasetSummary = {
  id: string;
  agent_system_id: string;
  key: string;
  name: string;
  description: string;
  versions: DatasetVersionSummary[];
};

export type ModelOption = {
  id: string;
  provider: string;
  label: string;
  supports: string[];
  available: boolean;
  notice?: string | null;
  blocked_agent_system_keys?: string[];
};

export type Catalog = {
  agent_systems: AgentSystemSummary[];
  prompts: PromptSummary[];
  datasets: DatasetSummary[];
  models: ModelOption[];
};

export type PortfolioSnapshotSummary = {
  id: string;
  agent_system_id: string;
  source_trace_id: string | null;
  resource_identity: string;
  schema_version: number;
  label: string;
  as_of: string;
  source_kind: string;
  is_synthetic: boolean;
  content_hash: string;
  position_count: number;
  created_at: string;
};

export type PortfolioSnapshotDetail = PortfolioSnapshotSummary & {
  content_available: boolean;
  content: Record<string, unknown>;
};

export type RuntimeInputSnapshotSummary = {
  id: string;
  agent_system_id: string;
  source_trace_id: string | null;
  node_id: string;
  source_key: string;
  schema_version: number;
  label: string;
  observed_at: string;
  fetched_at: string;
  provider: string;
  source_kind: string;
  is_synthetic: boolean;
  content_hash: string;
  created_at: string;
};

export type RuntimeInputSnapshotDetail = RuntimeInputSnapshotSummary & {
  provenance: Record<string, unknown>;
  content_available: boolean;
  content: Record<string, unknown>;
};

export type NodeSnapshotUsage = {
  trace_id: string;
  agent_system_key: string;
  span_id: string;
  node_id: string;
  role: "produced" | "consumed";
  resolution_mode: "computed" | "live" | "replayed" | "resolved" | "seeded";
  status: string;
  latency_ms: number;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
};

export type NodeSnapshotSummary = {
  id: string;
  agent_system_id: string;
  agent_system_key: string;
  product_key: string;
  flow_key: string;
  flow_name: string;
  node_id: string;
  node_label: string;
  node_kind: "deterministic" | "external_input";
  output_key: string;
  resource_identity: string | null;
  snapshot_kind: "state" | "external_observation" | "node_output";
  schema_version: number;
  label: string;
  observed_at: string;
  captured_at: string;
  source: string;
  provider: string | null;
  capture_mode: "computed" | "live" | "replayed" | "seeded" | "imported";
  is_synthetic: boolean;
  content_hash: string;
  usage_count: number;
  latest_usage: NodeSnapshotUsage | null;
};

export type NodeSnapshotDetail = NodeSnapshotSummary & {
  provenance: Record<string, unknown>;
  node_metadata: Record<string, unknown>;
  usages: NodeSnapshotUsage[];
  content_available: boolean;
  content: Record<string, unknown>;
};

export type RuntimeInputPolicy = {
  source: string;
  runtime_mode: "locked" | "refresh";
  evaluation_mode: "locked" | "refresh";
  schema_version: number;
  required: boolean;
};

export type NodeSnapshotPolicy = {
  output_key: string;
  snapshot_kind: "state" | "external_observation" | "node_output";
  schema_version: number;
  binding_mode: "produce" | "consume" | "produce_or_consume";
  reveal_policy_key: string;
  required: boolean;
};

export type NodeResourcePolicy = {
  product_key: string;
  resource_key: string;
  producer_system_key: string;
  producer_node_id: string;
  producer_output_key: string;
  producer_snapshot_kind: "state" | "external_observation" | "node_output";
  schema_version: number;
  runtime_mode: "current" | "locked";
  evaluation_mode: "locked";
  required: boolean;
};

export type NodeResourceSelection =
  | { mode: "current"; identity: string; snapshot_id?: never }
  | { mode: "locked"; snapshot_id: string; identity?: never };

export type GraphNodeDefinition = {
  id: string;
  label: string;
  kind: "deterministic" | "llm";
  handler: string;
  task: string | null;
  prompt_key?: string | null;
  runtime_input_policy?: RuntimeInputPolicy | null;
  snapshot_policy?: NodeSnapshotPolicy | null;
  resource_policy?: NodeResourcePolicy | null;
};

export type GraphDefinition = {
  entry_point: string;
  output_node: string;
  nodes: GraphNodeDefinition[];
  edges: Array<{ source: string; target: string }>;
};

export type AgentVersionDetail = {
  id: string;
  agent_system_id: string;
  version: number;
  definition: GraphDefinition;
  content_hash: string;
  created_at: string;
};

export type PromptVersionDetail = {
  id: string;
  prompt_id: string;
  version: number;
  content: string;
  content_hash: string;
  created_at: string;
};

export type TraceSpan = {
  id: string;
  trace_id: string;
  node_id: string;
  node_kind: "deterministic" | "external_input" | "llm";
  sequence: number;
  status: string;
  system_prompt: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  latency_ms: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  started_at: string;
  completed_at: string | null;
  runtime_input_snapshot_id?: string | null;
  node_snapshot_id?: string | null;
  snapshot_role?: "produced" | "consumed" | null;
  snapshot_resolution_mode?:
    "computed" | "live" | "replayed" | "resolved" | "seeded" | null;
  snapshot_metadata?: Record<string, unknown>;
};

export type Trace = {
  id: string;
  status: string;
  agent_system_id: string;
  agent_system_key: string;
  agent_system_name: string;
  agent_system_version_id: string;
  prompt_version_id: string;
  origin_type: "runtime" | "evaluation" | "legacy_unknown";
  evaluation_run_id: string | null;
  evaluation_dataset_item_id: string | null;
  dataset_membership_count: number;
  dataset_count: number;
  dataset_memberships: DatasetMembership[];
  model_id: string;
  request_input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  latency_ms: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  started_at: string;
  completed_at: string | null;
  graph_definition: GraphDefinition | null;
  spans: TraceSpan[];
  runtime_input_snapshot_ids?: Record<string, string>;
  node_snapshot_ids?: Record<string, string>;
  node_resource_selections?: Record<string, NodeResourceSelection>;
  capture_node_outputs?: boolean;
};

export type DatasetMembership = {
  dataset_id: string;
  dataset_key: string;
  dataset_name: string;
  dataset_version_id: string;
  dataset_version: number;
  dataset_version_status: "draft" | "final";
  dataset_item_id: string;
  created_at: string;
};

export type DatasetTarget = {
  dataset_id: string;
  dataset_key: string;
  dataset_name: string;
  dataset_version_id: string;
  dataset_version: number;
  eligible: boolean;
  existing_item_id: string | null;
  reason:
    | "already_in_version"
    | "trace_not_complete"
    | "trace_not_replayable"
    | null;
  warnings: Array<"evaluation_origin" | "same_source_dataset">;
};

export type TraceDatasetTargets = {
  trace_id: string;
  memberships: DatasetMembership[];
  targets: DatasetTarget[];
  evaluation_expected: Record<string, unknown> | null;
  evaluation_actual: Record<string, unknown> | null;
};

export type DatasetItem = {
  id: string;
  dataset_version_id: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
  source_trace_id: string | null;
  created_at: string;
  updated_at: string;
  runtime_input_snapshot_ids?: Record<string, string>;
  node_resource_selections?: Record<string, NodeResourceSelection>;
};

export type DatasetVersionDetail = DatasetVersionSummary & {
  dataset_id: string;
  items: DatasetItem[];
};

export type EvalMetrics = {
  accuracy: number;
  severity_accuracy: number;
  route_accuracy: number;
  exact_match: number;
  precision_macro: number;
  recall_macro: number;
  f1_macro: number;
  human_review_accuracy: number;
  total_cost_usd: number;
  average_cost_usd: number;
  average_latency_ms: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  item_count: number;
  [key: string]: number;
};

export type EvalModelResult = {
  id: string;
  eval_run_id: string;
  model_id: string;
  metrics: EvalMetrics;
  created_at: string;
};

export type EvalItemResult = {
  id: string;
  dataset_item_id: string;
  model_id: string;
  trace_id: string;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  scores: Record<string, number>;
};

export type EvalRun = {
  id: string;
  status: string;
  dataset_version_id: string;
  agent_system_version_id: string;
  prompt_version_id: string;
  model_ids: string[];
  error: string | null;
  created_at: string;
  completed_at: string | null;
  results: EvalModelResult[];
  item_results: EvalItemResult[];
};
