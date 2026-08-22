"""The parsed graph blueprint.

A graph definition is stored as JSON and arrives from the API as a dict, so it
is parsed once — at version creation and at the start of a run — and passed
downstream as these models. Nothing below the parse boundary should be reading
`node["kind"]` or `.get("runtime_input_policy", {})` again.

The API layer re-exports these models from `schemas.py`, so they are also the
published request contract; the shapes must stay in sync with what the frontend
generates from OpenAPI.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_serializer, model_validator

NodeKind = Literal["deterministic", "llm"]
SnapshotKind = Literal["state", "external_observation", "node_output"]


class GraphModel(BaseModel):
    """Rejects unknown keys so a typo in a definition fails at the door."""

    model_config = ConfigDict(extra="forbid")


@dataclass(frozen=True)
class RuntimeInputMode:
    """How one node resolves its runtime input for the run in progress."""

    source: str
    mode: Literal["locked", "refresh"]
    schema_version: int


class RuntimeInputPolicy(GraphModel):
    source: str = Field(pattern=r"^[a-z][a-z0-9_]{1,80}$")
    schema_version: int = Field(default=1, ge=1)
    required: bool = True
    runtime_mode: Literal["locked", "refresh"] = "refresh"
    evaluation_mode: Literal["locked", "refresh"] = "locked"

    def mode_for(self, *, evaluation: bool) -> RuntimeInputMode:
        return RuntimeInputMode(
            source=self.source,
            mode=self.evaluation_mode if evaluation else self.runtime_mode,
            schema_version=self.schema_version,
        )


class NodeSnapshotPolicy(GraphModel):
    output_key: str = Field(pattern=r"^[a-z][a-z0-9_]{1,80}$")
    snapshot_kind: SnapshotKind
    schema_version: int = Field(default=1, ge=1)
    binding_mode: Literal["produce", "consume", "produce_or_consume"] = "produce"
    reveal_policy_key: str = Field(
        default="generic",
        pattern=r"^[a-z][a-z0-9_]{1,80}$",
    )
    required: bool = True


class NodeResourcePolicy(GraphModel):
    """Server-owned producer contract for a consumer node's persisted resource."""

    product_key: str = Field(pattern=r"^[a-z][a-z0-9-]{1,119}$")
    resource_key: str = Field(pattern=r"^[a-z][a-z0-9_]{1,80}$")
    producer_system_key: str = Field(pattern=r"^[a-z][a-z0-9-]{1,119}$")
    producer_node_id: str = Field(pattern=r"^[a-z][a-z0-9_]{1,80}$")
    producer_output_key: str = Field(pattern=r"^[a-z][a-z0-9_]{1,80}$")
    producer_snapshot_kind: SnapshotKind
    schema_version: int = Field(default=1, ge=1)
    runtime_mode: Literal["current", "locked"] = "current"
    evaluation_mode: Literal["locked"] = "locked"
    required: bool = True


class NodeResourceSelection(GraphModel):
    mode: Literal["current", "locked"]
    identity: str | None = Field(default=None, min_length=1, max_length=120)
    snapshot_id: str | None = Field(default=None, min_length=1, max_length=120)

    @model_validator(mode="after")
    def validate_selection(self) -> NodeResourceSelection:
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


class AgentNodeDefinition(GraphModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_]{1,80}$")
    label: str = Field(min_length=1, max_length=120)
    kind: NodeKind
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


class AgentEdgeDefinition(GraphModel):
    source: str
    target: str


class AgentGraphDefinition(GraphModel):
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

    def node(self, node_id: str) -> AgentNodeDefinition | None:
        return next((node for node in self.nodes if node.id == node_id), None)

    def prompt_keys(self) -> set[str]:
        return {node.prompt_key for node in self.nodes if node.kind == "llm" and node.prompt_key}

    def runtime_input_modes(self, *, evaluation: bool) -> dict[str, RuntimeInputMode]:
        return {
            node.id: node.runtime_input_policy.mode_for(evaluation=evaluation)
            for node in self.nodes
            if node.runtime_input_policy is not None
        }

    def resource_policies(self) -> dict[str, NodeResourcePolicy]:
        return {
            node.id: node.resource_policy for node in self.nodes if node.resource_policy is not None
        }


def parse_graph_definition(value: AgentGraphDefinition | dict[str, Any]) -> AgentGraphDefinition:
    """Parse a stored or requested definition; already-parsed values pass through."""
    if isinstance(value, AgentGraphDefinition):
        return value
    return AgentGraphDefinition.model_validate(value)
