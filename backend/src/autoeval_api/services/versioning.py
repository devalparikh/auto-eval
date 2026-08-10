import hashlib
import json
from typing import Any

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from autoeval_api.models import (
    AgentSystemRecord,
    AgentSystemVersionRecord,
    PromptRecord,
    PromptVersionRecord,
)
from autoeval_api.schemas import (
    AgentGraphDefinition,
    AgentSystemSummary,
    PromptSummary,
    VersionSummary,
)


def hash_json(value: dict[str, Any]) -> str:
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def hash_text(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def create_agent_version(
    session: Session,
    agent_system: AgentSystemRecord,
    definition: AgentGraphDefinition | dict[str, Any],
) -> AgentSystemVersionRecord:
    if isinstance(definition, AgentGraphDefinition):
        definition.validate_references()
        payload = definition.model_dump(mode="json")
    else:
        parsed = AgentGraphDefinition.model_validate(definition)
        parsed.validate_references()
        payload = parsed.model_dump(mode="json")

    content_hash = hash_json(payload)
    duplicate = (
        session.query(AgentSystemVersionRecord)
        .filter_by(agent_system_id=agent_system.id, content_hash=content_hash)
        .first()
    )
    if duplicate:
        raise ValueError(f"This graph already exists as version {duplicate.version}")

    current = (
        session.query(func.max(AgentSystemVersionRecord.version))
        .filter_by(agent_system_id=agent_system.id)
        .scalar()
        or 0
    )
    version = AgentSystemVersionRecord(
        agent_system_id=agent_system.id,
        version=current + 1,
        definition=payload,
        content_hash=content_hash,
    )
    session.add(version)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise ValueError("A concurrent request created the same graph version") from None
    session.refresh(version)
    return version


def create_prompt_version(
    session: Session, prompt: PromptRecord, content: str
) -> PromptVersionRecord:
    normalized = content.strip()
    content_hash = hash_text(normalized)
    duplicate = (
        session.query(PromptVersionRecord)
        .filter_by(prompt_id=prompt.id, content_hash=content_hash)
        .first()
    )
    if duplicate:
        raise ValueError(f"This prompt already exists as version {duplicate.version}")

    current = (
        session.query(func.max(PromptVersionRecord.version)).filter_by(prompt_id=prompt.id).scalar()
        or 0
    )
    version = PromptVersionRecord(
        prompt_id=prompt.id,
        version=current + 1,
        content=normalized,
        content_hash=content_hash,
    )
    session.add(version)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise ValueError("A concurrent request created the same prompt version") from None
    session.refresh(version)
    return version


def latest_agent_version(session: Session) -> AgentSystemVersionRecord:
    version = (
        session.query(AgentSystemVersionRecord)
        .order_by(AgentSystemVersionRecord.version.desc())
        .first()
    )
    if version is None:
        raise LookupError("No agent system version exists")
    return version


def latest_prompt_version(session: Session) -> PromptVersionRecord:
    version = (
        session.query(PromptVersionRecord).order_by(PromptVersionRecord.version.desc()).first()
    )
    if version is None:
        raise LookupError("No prompt version exists")
    return version


def agent_system_summary(session: Session, system: AgentSystemRecord) -> AgentSystemSummary:
    versions = (
        session.query(AgentSystemVersionRecord)
        .filter_by(agent_system_id=system.id)
        .order_by(AgentSystemVersionRecord.version.desc())
        .all()
    )
    return AgentSystemSummary(
        id=system.id,
        key=system.key,
        name=system.name,
        description=system.description,
        versions=[_version_summary(item) for item in versions],
    )


def prompt_summary(session: Session, prompt: PromptRecord) -> PromptSummary:
    versions = (
        session.query(PromptVersionRecord)
        .filter_by(prompt_id=prompt.id)
        .order_by(PromptVersionRecord.version.desc())
        .all()
    )
    return PromptSummary(
        id=prompt.id,
        key=prompt.key,
        name=prompt.name,
        description=prompt.description,
        versions=[_version_summary(item) for item in versions],
    )


def _version_summary(
    version: AgentSystemVersionRecord | PromptVersionRecord,
) -> VersionSummary:
    return VersionSummary(
        id=version.id,
        version=version.version,
        content_hash=version.content_hash,
        created_at=version.created_at,
    )
