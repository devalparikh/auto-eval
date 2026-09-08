from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from autoeval_api.graph.definition import AgentGraphDefinition


class ImportModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ImportSource(ImportModel):
    kind: Literal["local", "github"]
    display_path: str | None = Field(default=None, max_length=500)


class ManifestSystem(ImportModel):
    key: str = Field(pattern=r"^[a-z][a-z0-9-]{1,119}$")
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=10_000)
    input_template: dict[str, Any] = Field(default_factory=dict)


class ManifestPrompt(ImportModel):
    content: str = Field(min_length=1, max_length=100_000)

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Prompt content cannot be blank")
        return value.strip()


class AutoEvalManifest(ImportModel):
    schema_version: Literal[1]
    system: ManifestSystem
    graph: AgentGraphDefinition
    prompt: ManifestPrompt


class SystemImportInspectRequest(ImportModel):
    manifest: AutoEvalManifest | None = None
    github_url: str | None = Field(default=None, min_length=1, max_length=2_000)
    source: ImportSource | None = None

    @model_validator(mode="after")
    def require_one_source(self) -> SystemImportInspectRequest:
        if (self.manifest is None) == (self.github_url is None):
            raise ValueError("Provide either manifest or github_url")
        if self.github_url is not None and self.source is not None:
            raise ValueError("source is only accepted with a manifest")
        if self.source is not None and self.source.kind != "local":
            raise ValueError("Manifest source kind must be local")
        return self


class SystemImportCounts(ImportModel):
    nodes: int
    edges: int
    llm_nodes: int
    deterministic_nodes: int


class SystemImportCompatibility(ImportModel):
    runnable: bool
    evaluation_scoring: Literal["exact_json", "registered"]
    handlers: list[str]


class SystemImportPreview(ImportModel):
    digest: str
    manifest: AutoEvalManifest
    source: ImportSource
    warnings: list[str]
    existing_system_id: str | None
    next_graph_version: int
    next_prompt_version: int
    target_graph_version: int
    target_prompt_version: int
    graph_version_created: bool
    prompt_version_created: bool
    creates_system: bool
    counts: SystemImportCounts
    compatibility: SystemImportCompatibility


class SystemImportCommitRequest(ImportModel):
    manifest: AutoEvalManifest
    expected_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    expected_system_key: str = Field(pattern=r"^[a-z][a-z0-9-]{1,119}$")
    expected_system_id: str | None = None
    expected_graph_version: int = Field(ge=1)
    expected_prompt_version: int = Field(ge=1)
    source: ImportSource | None = None


class SystemImportResult(ImportModel):
    agent_system_id: str
    graph_version_id: str
    graph_version: int
    graph_version_created: bool
    prompt_id: str
    prompt_version_id: str
    prompt_version: int
    prompt_version_created: bool
    dataset_id: str | None
    dataset_version_id: str | None
    created_system: bool
    digest: str


class EffectiveHandlersResponse(ImportModel):
    system_key: str | None
    deterministic: list[str]
    llm: list[str]
