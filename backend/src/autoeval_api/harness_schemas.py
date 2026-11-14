"""Portable capture and external-run contracts. No executable code is imported."""

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator


class HarnessModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class ConnectHarness(HarnessModel):
    key: str = Field(pattern=r"^[a-z][a-z0-9-]{1,99}$")
    name: str = Field(min_length=1, max_length=120)
    harness: Literal["claude-code", "codex", "hermes", "opencode", "pi", "other"]


class ApplicationCheck(HarnessModel):
    name: str = Field(pattern=r"^[a-zA-Z0-9_.-]{1,80}$")
    path: list[str | int] = Field(max_length=20)
    equals: JsonValue


class ApplicationCase(HarnessModel):
    input: dict[str, JsonValue]
    checks: list[ApplicationCheck] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_checks(self):
        if len({check.name for check in self.checks}) != len(self.checks):
            raise ValueError("Check names must be unique")
        return self


class HarnessTask(HarnessModel):
    key: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$")
    partition: Literal["train", "validation", "benchmark"]
    prompt: str = Field(min_length=1, max_length=100_000)
    repository_revision: str = Field(default="", max_length=120)
    test_command: list[str] = Field(default_factory=list, max_length=40)

    application_case: ApplicationCase | None = None

    @model_validator(mode="after")
    def benchmark_contract(self):
        if self.partition == "benchmark" and (
            not re.fullmatch(r"[a-f0-9]{40}", self.repository_revision)
            or not (bool(self.test_command) ^ (self.application_case is not None))
        ):
            raise ValueError(
                "Benchmark needs a pinned revision and test_command or application_case"
            )
        if self.application_case is not None and self.partition != "benchmark":
            raise ValueError("Application cases are benchmark-only; never training captures")
        if any(not part or len(part) > 1000 for part in self.test_command):
            raise ValueError("Invalid test command argument")
        return self


class HarnessCapture(HarnessModel):
    schema_version: Literal[1] = 1
    request_id: str = Field(min_length=1, max_length=120)
    session_id: str = Field(min_length=1, max_length=120)
    task_key: str = Field(min_length=1, max_length=100)
    harness_revision: str = Field(min_length=1, max_length=200)
    configuration_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    model: str = Field(min_length=1, max_length=240)
    protocol: Literal["chat", "responses", "anthropic"]
    request: dict[str, Any]
    response: dict[str, Any]
    latency_ms: float = Field(ge=0)
    input_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)
    cost_usd: float | None = Field(default=None, ge=0)


class CaptureReview(HarnessModel):
    decision: Literal["approved", "rejected"]


class HarnessSuite(HarnessModel):
    name: str = Field(min_length=1, max_length=120)
    task_keys: list[str] = Field(min_length=1, max_length=100)
    repetitions: int = Field(default=1, ge=1, le=10)


class HarnessCaseResult(HarnessModel):
    task_key: str
    repetition: int = Field(ge=1, le=10)
    status: Literal["completed", "error", "timeout"]
    test_exit_code: int | None = None
    test_output_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    latency_ms: float = Field(ge=0)
    input_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)
    cost_usd: float | None = Field(default=None, ge=0)

    checks: dict[str, bool] | None = None
    error_code: (
        Literal["adapter_exit", "adapter_timeout", "adapter_output", "adapter_protocol", "checkout"]
        | None
    ) = None

    @model_validator(mode="after")
    def completed_evidence(self):
        if self.status == "completed" and (
            self.test_exit_code is None or self.test_output_hash is None
        ):
            raise ValueError("Completed cases require the test exit code and output SHA-256")
        return self


class HarnessRun(HarnessModel):
    request_id: str = Field(min_length=1, max_length=120)
    suite_id: str
    label: str = Field(min_length=1, max_length=120)
    model: str = Field(min_length=1, max_length=240)
    harness_revision: str = Field(min_length=1, max_length=200)
    configuration_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    execution_mode: Literal["offline", "live"] | None = None
    results: list[HarnessCaseResult] = Field(min_length=1, max_length=1000)


class HarnessReceipt(HarnessModel):
    id: str
    content_hash: str


class HarnessCaptureSummary(HarnessModel):
    id: str
    task_key: str
    session_id: str
    model: str
    review: str
    partition: str
    content_hash: str
    input_tokens: int | None
    output_tokens: int | None


class HarnessRunSummary(HarnessModel):
    id: str
    suite_id: str
    label: str
    model: str
    harness_revision: str
    configuration_hash: str
    pass_rate: float
    passed: int
    total: int
    failures: int
    mean_latency_ms: float
    cost_usd: float | None
    content_hash: str


class HarnessWorkspace(HarnessModel):
    system_id: str
    key: str
    name: str
    harness: str
    tasks: list[HarnessTask]
    captures: list[HarnessCaptureSummary]
    suites: list[dict[str, Any]]
    runs: list[HarnessRunSummary]


class HarnessTrainingExport(HarnessModel):
    dataset_version_id: str
    train: list[dict[str, Any]]
    validation: list[dict[str, Any]]
    content_hash: str
