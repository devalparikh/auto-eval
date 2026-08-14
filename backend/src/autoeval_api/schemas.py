from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_serializer, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RuntimeInputPolicy(StrictModel):
    source: str = Field(pattern=r"^[a-z][a-z0-9_]{1,80}$")
    schema_version: int = Field(default=1, ge=1)
    required: bool = True
    runtime_mode: Literal["locked", "refresh"] = "refresh"
    evaluation_mode: Literal["locked", "refresh"] = "locked"


class NodeSnapshotPolicy(StrictModel):
    output_key: str = Field(pattern=r"^[a-z][a-z0-9_]{1,80}$")
    snapshot_kind: Literal["state", "external_observation", "node_output"]
    schema_version: int = Field(default=1, ge=1)
    binding_mode: Literal["produce", "consume", "produce_or_consume"] = "produce"
    reveal_policy_key: str = Field(
        default="generic",
        pattern=r"^[a-z][a-z0-9_]{1,80}$",
    )
    required: bool = True


class NodeResourcePolicy(StrictModel):
    """Server-owned producer contract for a consumer node's persisted resource."""

    product_key: str = Field(pattern=r"^[a-z][a-z0-9-]{1,119}$")
    resource_key: str = Field(pattern=r"^[a-z][a-z0-9_]{1,80}$")
    producer_system_key: str = Field(pattern=r"^[a-z][a-z0-9-]{1,119}$")
    producer_node_id: str = Field(pattern=r"^[a-z][a-z0-9_]{1,80}$")
    producer_output_key: str = Field(pattern=r"^[a-z][a-z0-9_]{1,80}$")
    producer_snapshot_kind: Literal["state", "external_observation", "node_output"]
    schema_version: int = Field(default=1, ge=1)
    runtime_mode: Literal["current", "locked"] = "current"
    evaluation_mode: Literal["locked"] = "locked"
    required: bool = True


class NodeResourceSelection(StrictModel):
    mode: Literal["current", "locked"]
    identity: str | None = Field(default=None, min_length=1, max_length=120)
    snapshot_id: str | None = Field(default=None, min_length=1, max_length=120)

    @model_validator(mode="after")
    def validate_selection(self) -> "NodeResourceSelection":
        if self.mode == "current":
            if self.identity is None or self.snapshot_id is not None:
                raise ValueError(
                    "Current resource selection requires identity and forbids snapshot_id"
                )
        elif self.snapshot_id is None or self.identity is not None:
            raise ValueError("Locked resource selection requires snapshot_id and forbids identity")
        return self

    @model_serializer(mode="plain")
    def serialize_selection(self) -> dict[str, str]:
        if self.mode == "current":
            return {"mode": self.mode, "identity": str(self.identity)}
        return {"mode": self.mode, "snapshot_id": str(self.snapshot_id)}


class AgentNodeDefinition(StrictModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_]{1,80}$")
    label: str = Field(min_length=1, max_length=120)
    kind: Literal["deterministic", "llm"]
    handler: str = Field(pattern=r"^[a-z][a-z0-9_]{1,80}$")
    task: str | None = Field(default=None, max_length=240)
    prompt_key: str | None = Field(
        default=None,
        pattern=r"^[a-z][a-z0-9-]{1,119}$",
    )
    response_schema: dict[str, Any] | None = None
    runtime_input_policy: RuntimeInputPolicy | None = None
    snapshot_policy: NodeSnapshotPolicy | None = None
    resource_policy: NodeResourcePolicy | None = None


class AgentEdgeDefinition(StrictModel):
    source: str
    target: str


class AgentGraphDefinition(StrictModel):
    entry_point: str
    output_node: str
    nodes: list[AgentNodeDefinition] = Field(min_length=1, max_length=80)
    edges: list[AgentEdgeDefinition] = Field(max_length=200)

    def validate_references(self) -> None:
        node_ids = {node.id for node in self.nodes}
        if len(node_ids) != len(self.nodes):
            raise ValueError("Node IDs must be unique")
        if self.entry_point not in node_ids:
            raise ValueError("Entry point must reference a node")
        if self.output_node not in node_ids:
            raise ValueError("Output node must reference a node")
        for edge in self.edges:
            if edge.source not in node_ids or edge.target not in node_ids:
                raise ValueError("Every edge must reference known nodes")
        for node in self.nodes:
            if node.kind != "llm" and node.prompt_key is not None:
                raise ValueError("Only LLM nodes can reference a prompt key")
            if node.kind != "deterministic" and node.snapshot_policy is not None:
                raise ValueError("Only deterministic nodes can declare a snapshot policy")
            if node.kind != "deterministic" and node.resource_policy is not None:
                raise ValueError("Only deterministic nodes can declare a resource policy")


class VersionSummary(BaseModel):
    id: str
    version: int
    content_hash: str | None = None
    created_at: datetime


class AgentSystemSummary(BaseModel):
    id: str
    key: str
    product_key: str
    flow_key: str
    flow_name: str
    name: str
    description: str
    versions: list[VersionSummary]
    default_model_ids: list[str] = []
    input_template: dict[str, Any] = {}
    dataset_editor: str = "json"
    primary_metric: str = "accuracy"


class PromptSummary(BaseModel):
    id: str
    agent_system_id: str
    key: str
    name: str
    description: str
    versions: list[VersionSummary]


class DatasetVersionSummary(BaseModel):
    id: str
    version: int
    status: str
    item_count: int
    created_at: datetime
    finalized_at: datetime | None


class DatasetSummary(BaseModel):
    id: str
    agent_system_id: str
    key: str
    name: str
    description: str
    versions: list[DatasetVersionSummary]


class ModelOption(BaseModel):
    id: str
    provider: str
    label: str
    supports: list[str]
    available: bool
    notice: str | None = None
    blocked_agent_system_keys: list[str] = []


class CatalogResponse(BaseModel):
    agent_systems: list[AgentSystemSummary]
    prompts: list[PromptSummary]
    datasets: list[DatasetSummary]
    models: list[ModelOption]


class PortfolioSnapshotSummary(BaseModel):
    id: str
    agent_system_id: str
    source_trace_id: str | None
    resource_identity: str
    schema_version: int
    label: str
    as_of: str
    source_kind: str
    is_synthetic: bool
    content_hash: str
    position_count: int
    created_at: datetime


class PortfolioSnapshotDetail(PortfolioSnapshotSummary):
    content_available: bool
    content: dict[str, Any]


class RuntimeInputSnapshotSummary(BaseModel):
    id: str
    agent_system_id: str
    source_trace_id: str | None
    node_id: str
    source_key: str
    schema_version: int
    label: str
    observed_at: datetime
    fetched_at: datetime
    provider: str
    source_kind: str
    is_synthetic: bool
    content_hash: str
    created_at: datetime


class RuntimeInputSnapshotDetail(RuntimeInputSnapshotSummary):
    provenance: dict[str, Any]
    content_available: bool
    content: dict[str, Any]


class NodeSnapshotUsage(BaseModel):
    trace_id: str
    agent_system_key: str
    span_id: str
    node_id: str
    role: Literal["produced", "consumed"]
    resolution_mode: Literal["computed", "live", "replayed", "resolved", "seeded"]
    status: str
    latency_ms: float
    started_at: datetime
    completed_at: datetime | None
    error: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class NodeSnapshotSummary(BaseModel):
    id: str
    agent_system_id: str
    agent_system_key: str
    product_key: str
    flow_key: str
    flow_name: str
    node_id: str
    node_label: str
    node_kind: Literal["deterministic", "external_input"]
    output_key: str
    resource_identity: str | None = None
    snapshot_kind: Literal["state", "external_observation", "node_output"]
    schema_version: int
    label: str
    observed_at: datetime
    captured_at: datetime
    source: str
    provider: str | None = None
    capture_mode: Literal["computed", "live", "replayed", "seeded", "imported"]
    is_synthetic: bool
    content_hash: str
    usage_count: int = 0
    latest_usage: NodeSnapshotUsage | None = None


class NodeSnapshotDetail(NodeSnapshotSummary):
    provenance: dict[str, Any] = Field(default_factory=dict)
    node_metadata: dict[str, Any] = Field(default_factory=dict)
    usages: list[NodeSnapshotUsage] = Field(default_factory=list)
    content_available: bool
    content: dict[str, Any]


class ArtifactKind(StrEnum):
    GRAPH = "graph"
    PROMPT = "prompt"
    DATASET = "dataset"
    NODE_SNAPSHOT = "node_snapshot"
    PORTFOLIO_SNAPSHOT = "portfolio_snapshot"
    RUNTIME_INPUT = "runtime_input"


class NodePromptArtifactBinding(BaseModel):
    node_id: str
    prompt_key: str | None
    uses_legacy_default: bool
    current_prompt_version_id: str | None = None
    available_versions: list[VersionSummary] = []


class ArtifactSummary(BaseModel):
    id: str
    kind: ArtifactKind
    agent_system_id: str
    key: str
    name: str
    version: int | None = None
    status: str | None = None
    content_hash: str | None = None
    content_available: bool = True
    created_at: datetime


class ArtifactCatalogResponse(BaseModel):
    agent_system_id: str
    agent_system_key: str
    agent_system_name: str
    artifacts: list[ArtifactSummary]


class ArtifactDetail(ArtifactSummary):
    content: Any
    node_prompt_bindings: list[NodePromptArtifactBinding] = []


class CreateAgentVersionRequest(StrictModel):
    definition: AgentGraphDefinition


class CreatePromptVersionRequest(StrictModel):
    content: str = Field(min_length=1, max_length=100_000)


class AgentVersionDetail(BaseModel):
    id: str
    agent_system_id: str
    version: int
    definition: dict[str, Any]
    content_hash: str
    created_at: datetime


class PromptVersionDetail(BaseModel):
    id: str
    prompt_id: str
    version: int
    content: str
    content_hash: str
    created_at: datetime


class RunTraceRequest(StrictModel):
    input: dict[str, Any]
    model_id: str = "mock/incident-specialist"
    agent_system_id: str | None = None
    agent_system_version_id: str | None = None
    prompt_version_id: str | None = None
    prompt_version_ids: dict[str, str] = Field(default_factory=dict, max_length=80)
    runtime_input_snapshot_ids: dict[str, str] = Field(default_factory=dict, max_length=80)
    node_resource_selections: dict[str, NodeResourceSelection] = Field(
        default_factory=dict,
        max_length=80,
    )
    capture_node_outputs: bool = False


class TraceSpanResponse(BaseModel):
    id: str
    trace_id: str
    node_id: str
    node_kind: str
    prompt_version_id: str | None
    runtime_input_snapshot_id: str | None
    node_snapshot_id: str | None = None
    snapshot_role: str | None = None
    snapshot_resolution_mode: str | None = None
    snapshot_metadata: dict[str, Any] = Field(default_factory=dict)
    sequence: int
    status: str
    system_prompt: str | None
    input: dict[str, Any]
    output: dict[str, Any] | None
    error: str | None
    latency_ms: float
    cost_usd: float
    input_tokens: int
    output_tokens: int
    started_at: datetime
    completed_at: datetime | None


class DatasetMembershipResponse(BaseModel):
    dataset_id: str
    dataset_key: str
    dataset_name: str
    dataset_version_id: str
    dataset_version: int
    dataset_version_status: str
    dataset_item_id: str
    created_at: datetime


class TraceResponse(BaseModel):
    id: str
    status: str
    agent_system_id: str
    agent_system_key: str
    agent_system_name: str
    agent_system_version_id: str
    prompt_version_id: str
    prompt_version_ids: dict[str, str] = {}
    runtime_input_snapshot_ids: dict[str, str] = {}
    node_snapshot_ids: dict[str, str] = {}
    node_resource_selections: dict[str, NodeResourceSelection] = {}
    capture_node_outputs: bool = False
    origin_type: str
    evaluation_run_id: str | None
    evaluation_dataset_item_id: str | None
    dataset_membership_count: int = 0
    dataset_count: int = 0
    dataset_memberships: list[DatasetMembershipResponse] = []
    model_id: str
    request_input: dict[str, Any]
    output: dict[str, Any] | None
    error: str | None
    latency_ms: float
    cost_usd: float
    input_tokens: int
    output_tokens: int
    started_at: datetime
    completed_at: datetime | None
    graph_definition: dict[str, Any] | None = None
    spans: list[TraceSpanResponse] = []


class CreateDatasetVersionRequest(StrictModel):
    clone_from_version_id: str | None = None


class DatasetItemInput(StrictModel):
    input: dict[str, Any]
    expected: dict[str, Any]
    runtime_input_snapshot_ids: dict[str, str] = Field(default_factory=dict, max_length=80)
    node_resource_selections: dict[str, NodeResourceSelection] = Field(
        default_factory=dict,
        max_length=80,
    )


class UpdateDatasetItemRequest(StrictModel):
    expected: dict[str, Any]
    input: dict[str, Any] | None = None
    runtime_input_snapshot_ids: dict[str, str] | None = Field(default=None, max_length=80)
    node_resource_selections: dict[str, NodeResourceSelection] | None = Field(
        default=None,
        max_length=80,
    )


class DatasetItemResponse(BaseModel):
    id: str
    dataset_version_id: str
    input: dict[str, Any]
    expected: dict[str, Any]
    runtime_input_snapshot_ids: dict[str, str] = {}
    node_resource_selections: dict[str, NodeResourceSelection] = {}
    source_trace_id: str | None
    created_at: datetime
    updated_at: datetime


class DatasetVersionDetail(DatasetVersionSummary):
    dataset_id: str
    items: list[DatasetItemResponse]


class AddTraceToDatasetRequest(StrictModel):
    expected: dict[str, Any]


class DatasetTargetResponse(BaseModel):
    dataset_id: str
    dataset_key: str
    dataset_name: str
    dataset_version_id: str
    dataset_version: int
    eligible: bool
    existing_item_id: str | None = None
    reason: str | None = None
    warnings: list[str] = []


class TraceDatasetTargetsResponse(BaseModel):
    trace_id: str
    memberships: list[DatasetMembershipResponse]
    targets: list[DatasetTargetResponse]
    evaluation_expected: dict[str, Any] | None = None
    evaluation_actual: dict[str, Any] | None = None


class CreateEvalRunRequest(StrictModel):
    dataset_version_id: str
    model_ids: list[str] = Field(min_length=1, max_length=12)
    agent_system_version_id: str | None = None
    prompt_version_id: str | None = None
    prompt_version_ids: dict[str, str] = Field(default_factory=dict, max_length=80)
    run_in_background: bool = True


class EvalModelResultResponse(BaseModel):
    id: str
    eval_run_id: str
    model_id: str
    metrics: dict[str, Any]
    created_at: datetime


class EvalItemResultResponse(BaseModel):
    id: str
    dataset_item_id: str
    model_id: str
    trace_id: str
    expected: dict[str, Any]
    actual: dict[str, Any]
    scores: dict[str, Any]


class EvalRunResponse(BaseModel):
    id: str
    status: str
    dataset_version_id: str
    agent_system_version_id: str
    prompt_version_id: str
    prompt_version_ids: dict[str, str] = {}
    model_ids: list[str]
    error: str | None
    created_at: datetime
    completed_at: datetime | None
    results: list[EvalModelResultResponse] = []
    item_results: list[EvalItemResultResponse] = []
