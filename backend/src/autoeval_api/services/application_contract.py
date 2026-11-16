"""Versioned, bounded application capture contracts. No executable schemas."""

from typing import Annotated, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

Label = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,47}$")]
Semantic = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_.-]{0,95}$")]
Hash = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
Id = Annotated[
    str, Field(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
]
Timestamp = Annotated[int, Field(ge=0, le=9007199254740991)]
# Apps name privacy categories; the instance and consent independently allow them.
Category = Label
Source = Literal["synthetic", "production"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class CaptureSettings(Strict):
    production_enabled: bool = True
    retention_days: int | None = Field(default=None, ge=1, le=3650)
    content_retention_days: int | None = Field(default=None, ge=1, le=3650)
    content_categories: list[Category] = Field(default_factory=list, max_length=32)


class ApplicationInput(Strict):
    id: Id = Field(default_factory=lambda: str(uuid4()))
    name: str = Field(min_length=1, max_length=96)
    key: "KeyInput | None" = None


class KeyInput(Strict):
    label: str = Field(default="App connection", min_length=1, max_length=80)
    # Required, so an omitted field never means "no expiry". ``None`` does.
    expiresAt: Timestamp | None


class RotationInput(KeyInput):
    retireAt: Timestamp | None = None


class Metric(Strict):
    semanticId: Semantic
    definitionVersion: int = Field(ge=1, le=1000000)
    unit: Label
    min: int | None = None
    max: int | None = None


class Check(Strict):
    semanticId: Semantic
    definitionVersion: int = Field(ge=1, le=1000000)
    expected: bool | None


class ValueSchema(Strict):
    type: Literal["string", "number", "integer", "boolean", "object", "array"]
    maxLength: int = Field(default=1000, ge=1, le=16000)
    maxItems: int = Field(default=32, ge=1, le=128)
    properties: dict[Label, "ValueSchema"] = Field(default_factory=dict, max_length=32)
    items: "ValueSchema | None" = None
    enum: list[Label] | None = Field(default=None, min_length=1, max_length=32)


class ContentField(Strict):
    category: Category
    valueSchema: ValueSchema


class EventDefinition(Strict):
    # Operational attributes are numbers/booleans or declared enums, never free text.
    attributes: dict[Label, ValueSchema] = Field(default_factory=dict, max_length=16)


class Policy(Strict):
    schemaVersion: Literal[2]
    metrics: dict[Label, Metric] = Field(default_factory=dict, max_length=32)
    checks: dict[Label, Check] = Field(default_factory=dict, max_length=32)
    steps: dict[Label, EventDefinition] = Field(default_factory=dict, max_length=32)
    outcomes: dict[Label, EventDefinition] = Field(default_factory=dict, max_length=32)
    content: dict[Label, ContentField] = Field(default_factory=dict, max_length=16)

    @model_validator(mode="after")
    def bounded_schema(self):
        nodes = 0

        def visit(spec, depth=0, operational=False):
            nonlocal nodes
            nodes += 1
            if depth > 4 or nodes > 256:
                raise ValueError("Schema too complex")
            if operational and (
                spec.type in {"object", "array"} or (spec.type == "string" and not spec.enum)
            ):
                raise ValueError("Operational fields cannot carry arbitrary content")
            if (spec.type == "array") != (spec.items is not None):
                raise ValueError("Array schema requires items")
            if spec.properties and spec.type != "object":
                raise ValueError("Only objects have properties")
            if spec.enum and spec.type != "string":
                raise ValueError("Only strings have enums")
            for child in spec.properties.values():
                visit(child, depth + 1)
            if spec.items:
                visit(spec.items, depth + 1)

        for definition in [*self.steps.values(), *self.outcomes.values()]:
            for spec in definition.attributes.values():
                visit(spec, operational=True)
        for field in self.content.values():
            visit(field.valueSchema)
        for metric in self.metrics.values():
            if metric.min is not None and metric.max is not None and metric.min > metric.max:
                raise ValueError("Invalid metric bounds")
        for definitions in (self.metrics, self.checks):
            ids = [item.semanticId for item in definitions.values()]
            if len(ids) != len(set(ids)):
                raise ValueError("Duplicate semantic identity")
        return self


class Revision(Strict):
    kind: Literal["git-sha1", "git-sha256", "artifact-sha256"]
    value: str = Field(pattern=r"^[0-9a-f]{40}([0-9a-f]{24})?$")

    @model_validator(mode="after")
    def correct_length(self):
        if len(self.value) != (40 if self.kind == "git-sha1" else 64):
            raise ValueError("Invalid revision")
        return self


class Model(Strict):
    role: Label
    provider: Label
    model: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,95}$")


class Experiment(Strict):
    revision: Revision
    promptHash: Hash | None
    configHash: Hash
    graphHash: Hash | None
    models: list[Model] = Field(max_length=16)
    mode: Literal["observed", "scripted", "live"] = "observed"
    datasetHash: Hash | None = None
    runId: Id | None = None

    @model_validator(mode="after")
    def provenance(self):
        if self.mode == "observed":
            if self.datasetHash is not None or self.runId is not None:
                raise ValueError("Observed experiments have no dataset/run")
        elif self.datasetHash is None or self.runId is None:
            raise ValueError("Evaluations require a finalized dataset and unique run")
        roles = [model.role for model in self.models]
        if roles != sorted(set(roles)):
            raise ValueError("Model roles must be sorted and unique")
        return self


class Connection(Strict):
    source: Source = "synthetic"
    policy: Policy
    experiment: Experiment


class Grant(Strict):
    id: Id
    source: Source
    categories: list[Category] = Field(default_factory=list, max_length=32)
    expiresAt: Timestamp | None = None


class Dataset(Strict):
    schemaVersion: Literal[1]
    caseIds: list[Hash] = Field(min_length=1, max_length=100)
    rubricHash: Hash

    @model_validator(mode="after")
    def ordered(self):
        if self.caseIds != sorted(set(self.caseIds)):
            raise ValueError("Cases must be sorted and unique")
        return self


class Step(Strict):
    id: Label
    parentId: Label | None = None
    kind: Literal["model", "tool", "validation", "persistence", "admission"]
    name: Label
    status: Literal["ok", "error", "partial", "cancelled"]
    durationMs: int | None = Field(default=None, ge=0, le=86400000)
    attributes: dict[Label, object] = Field(default_factory=dict, max_length=16)


class Observation(Strict):
    schemaVersion: Literal[2]
    id: Id
    experimentId: Hash
    policyVersion: Hash
    grantId: Id
    source: Source
    caseId: Hash | None = None
    startedAt: Timestamp
    endedAt: Timestamp
    status: Literal["ok", "error", "partial", "cancelled"]
    metrics: dict[Label, object] = Field(default_factory=dict, max_length=32)
    checks: dict[Label, object] = Field(default_factory=dict, max_length=32)
    steps: list[Step] = Field(default_factory=list, max_length=128)
    droppedSteps: int = Field(default=0, ge=0, le=1000000)
    content: dict[Label, object] = Field(default_factory=dict, max_length=16)
    redactorVersion: Hash | None = None
    coverage: dict[
        str,
        Literal[
            "not_measured",
            "not_authorized",
            "invalid_value",
            "redaction_failed",
            "size_limit",
            "retention_expired",
        ],
    ] = Field(default_factory=dict, max_length=96)


class Outcome(Strict):
    schemaVersion: Literal[2]
    id: Id
    traceId: Id
    policyVersion: Hash
    occurredAt: Timestamp
    name: Label
    attributes: dict[Label, object] = Field(default_factory=dict, max_length=16)
    content: dict[Label, object] = Field(default_factory=dict, max_length=16)
    redactorVersion: Hash | None = None


class Assessment(Strict):
    id: Id
    scorerHash: Hash
    ratings: dict[Label, Literal["pass", "fail", "unknown"]] = Field(max_length=32)
