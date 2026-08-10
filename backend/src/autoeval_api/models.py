from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from autoeval_api.db import Base


def new_id() -> str:
    return str(uuid4())


def utc_now() -> datetime:
    return datetime.now(UTC)


class DatasetStatus(StrEnum):
    DRAFT = "draft"
    FINAL = "final"


class RunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETE = "complete"
    FAILED = "failed"


class TraceOrigin(StrEnum):
    RUNTIME = "runtime"
    EVALUATION = "evaluation"
    LEGACY_UNKNOWN = "legacy_unknown"


class AgentSystemRecord(Base):
    __tablename__ = "agent_systems"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    key: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AgentSystemVersionRecord(Base):
    __tablename__ = "agent_system_versions"
    __table_args__ = (
        UniqueConstraint("agent_system_id", "version", name="uq_agent_system_version"),
        UniqueConstraint("agent_system_id", "content_hash", name="uq_agent_system_hash"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    agent_system_id: Mapped[str] = mapped_column(ForeignKey("agent_systems.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    definition: Mapped[dict[str, Any]] = mapped_column(JSON)
    content_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class PortfolioSnapshotRecord(Base):
    __tablename__ = "portfolio_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "agent_system_id",
            "content_hash",
            name="uq_portfolio_snapshot_system_hash",
        ),
    )

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    agent_system_id: Mapped[str] = mapped_column(ForeignKey("agent_systems.id"), index=True)
    source_trace_id: Mapped[str | None] = mapped_column(
        ForeignKey("traces.id"), nullable=True, index=True
    )
    schema_version: Mapped[int] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(String(200))
    as_of: Mapped[str] = mapped_column(String(64))
    source_kind: Mapped[str] = mapped_column(String(40), index=True)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    content_hash: Mapped[str] = mapped_column(String(64))
    document: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AgentInputSampleRecord(Base):
    __tablename__ = "agent_input_samples"
    __table_args__ = (
        UniqueConstraint(
            "agent_system_id",
            "source_trace_id",
            name="uq_agent_input_sample_source_trace",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    agent_system_id: Mapped[str] = mapped_column(ForeignKey("agent_systems.id"), index=True)
    source_trace_id: Mapped[str] = mapped_column(ForeignKey("traces.id"), index=True)
    input: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class PromptRecord(Base):
    __tablename__ = "prompts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    agent_system_id: Mapped[str] = mapped_column(ForeignKey("agent_systems.id"), index=True)
    key: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class PromptVersionRecord(Base):
    __tablename__ = "prompt_versions"
    __table_args__ = (
        UniqueConstraint("prompt_id", "version", name="uq_prompt_version"),
        UniqueConstraint("prompt_id", "content_hash", name="uq_prompt_hash"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    prompt_id: Mapped[str] = mapped_column(ForeignKey("prompts.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class DatasetRecord(Base):
    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    agent_system_id: Mapped[str] = mapped_column(ForeignKey("agent_systems.id"), index=True)
    key: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class DatasetVersionRecord(Base):
    __tablename__ = "dataset_versions"
    __table_args__ = (UniqueConstraint("dataset_id", "version", name="uq_dataset_version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default=DatasetStatus.DRAFT)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DatasetItemRecord(Base):
    __tablename__ = "dataset_items"
    __table_args__ = (
        UniqueConstraint(
            "dataset_version_id",
            "source_trace_id",
            name="uq_dataset_version_source_trace",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    dataset_version_id: Mapped[str] = mapped_column(ForeignKey("dataset_versions.id"), index=True)
    input: Mapped[dict[str, Any]] = mapped_column(JSON)
    expected: Mapped[dict[str, Any]] = mapped_column(JSON)
    source_trace_id: Mapped[str | None] = mapped_column(
        ForeignKey("traces.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class TraceRecord(Base):
    __tablename__ = "traces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    status: Mapped[str] = mapped_column(String(20), default=RunStatus.RUNNING)
    agent_system_version_id: Mapped[str] = mapped_column(
        ForeignKey("agent_system_versions.id"), index=True
    )
    prompt_version_id: Mapped[str] = mapped_column(ForeignKey("prompt_versions.id"), index=True)
    prompt_version_ids: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    origin_type: Mapped[str] = mapped_column(String(24), default=TraceOrigin.RUNTIME, index=True)
    evaluation_run_id: Mapped[str | None] = mapped_column(
        ForeignKey("eval_runs.id"), nullable=True, index=True
    )
    evaluation_dataset_item_id: Mapped[str | None] = mapped_column(
        ForeignKey(
            "dataset_items.id",
            name="fk_trace_evaluation_dataset_item",
            use_alter=True,
        ),
        nullable=True,
        index=True,
    )
    model_id: Mapped[str] = mapped_column(String(240), index=True)
    request_input: Mapped[dict[str, Any]] = mapped_column(JSON)
    output: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    latency_ms: Mapped[float] = mapped_column(Float, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TraceSpanRecord(Base):
    __tablename__ = "trace_spans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    trace_id: Mapped[str] = mapped_column(ForeignKey("traces.id"), index=True)
    node_id: Mapped[str] = mapped_column(String(160))
    node_kind: Mapped[str] = mapped_column(String(40))
    prompt_version_id: Mapped[str | None] = mapped_column(
        ForeignKey("prompt_versions.id"), nullable=True, index=True
    )
    sequence: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default=RunStatus.RUNNING)
    system_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    input: Mapped[dict[str, Any]] = mapped_column(JSON)
    output: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    latency_ms: Mapped[float] = mapped_column(Float, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EvalRunRecord(Base):
    __tablename__ = "eval_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    status: Mapped[str] = mapped_column(String(20), default=RunStatus.QUEUED)
    dataset_version_id: Mapped[str] = mapped_column(ForeignKey("dataset_versions.id"), index=True)
    agent_system_version_id: Mapped[str] = mapped_column(
        ForeignKey("agent_system_versions.id"), index=True
    )
    prompt_version_id: Mapped[str] = mapped_column(ForeignKey("prompt_versions.id"), index=True)
    prompt_version_ids: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    model_ids: Mapped[list[str]] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EvalModelResultRecord(Base):
    __tablename__ = "eval_model_results"
    __table_args__ = (UniqueConstraint("eval_run_id", "model_id", name="uq_eval_model"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    eval_run_id: Mapped[str] = mapped_column(ForeignKey("eval_runs.id"), index=True)
    model_id: Mapped[str] = mapped_column(String(240), index=True)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class EvalItemResultRecord(Base):
    __tablename__ = "eval_item_results"
    __table_args__ = (
        UniqueConstraint(
            "eval_run_id",
            "dataset_item_id",
            "model_id",
            name="uq_eval_item_model",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    eval_run_id: Mapped[str] = mapped_column(ForeignKey("eval_runs.id"), index=True)
    dataset_item_id: Mapped[str] = mapped_column(ForeignKey("dataset_items.id"), index=True)
    model_id: Mapped[str] = mapped_column(String(240), index=True)
    trace_id: Mapped[str] = mapped_column(ForeignKey("traces.id"), index=True)
    expected: Mapped[dict[str, Any]] = mapped_column(JSON)
    actual: Mapped[dict[str, Any]] = mapped_column(JSON)
    scores: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
