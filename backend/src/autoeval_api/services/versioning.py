import hashlib
import json
from typing import Any

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from autoeval_api.agent_systems.registry import system_spec
from autoeval_api.graph.definition import (
    AgentGraphDefinition,
    parse_graph_definition,
)
from autoeval_api.models import (
    AgentSystemRecord,
    AgentSystemVersionRecord,
    PromptRecord,
    PromptVersionRecord,
)
from autoeval_api.schemas import AgentSystemSummary, PromptSummary, VersionSummary


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
    parsed = parse_graph_definition(definition)
    parsed.validate_references()
    payload = parsed.model_dump(mode="json")

    _validate_graph_prompt_keys(session, agent_system, parsed)
    _validate_graph_resource_policies(session, agent_system, parsed)

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


def _validate_graph_resource_policies(
    session: Session,
    consumer: AgentSystemRecord,
    definition: AgentGraphDefinition,
) -> None:
    consumer_product = system_spec(consumer.key).product_key or consumer.key
    for policy in definition.resource_policies().values():
        if consumer_product != policy.product_key:
            raise ValueError(
                f"Resource consumer {consumer.key} does not belong to {policy.product_key}"
            )
        producer = (
            session.query(AgentSystemRecord).filter_by(key=policy.producer_system_key).one_or_none()
        )
        if producer is None:
            raise ValueError(f"Resource producer system not found: {policy.producer_system_key}")
        producer_product = system_spec(producer.key).product_key or producer.key
        if producer_product != policy.product_key:
            raise ValueError("Resource producer and consumer must belong to the same product")
        producer_version = (
            session.query(AgentSystemVersionRecord)
            .filter_by(agent_system_id=producer.id)
            .order_by(AgentSystemVersionRecord.version.desc())
            .first()
        )
        producer_node = (
            parse_graph_definition(producer_version.definition).node(policy.producer_node_id)
            if producer_version is not None
            else None
        )
        snapshot_policy = producer_node.snapshot_policy if producer_node is not None else None
        if snapshot_policy is None:
            raise ValueError(
                f"Resource producer node has no snapshot contract: {policy.producer_node_id}"
            )
        if (
            snapshot_policy.output_key != policy.producer_output_key
            or snapshot_policy.snapshot_kind != policy.producer_snapshot_kind
            or snapshot_policy.schema_version != policy.schema_version
            or snapshot_policy.binding_mode not in {"produce", "produce_or_consume"}
        ):
            raise ValueError(
                f"Resource producer snapshot contract does not match: {policy.producer_node_id}"
            )


def default_agent_system(session: Session) -> AgentSystemRecord:
    system = session.query(AgentSystemRecord).filter_by(key="incident-triage").first()
    system = system or session.query(AgentSystemRecord).order_by(AgentSystemRecord.name).first()
    if system is None:
        raise LookupError("No agent system exists")
    return system


def latest_agent_version(
    session: Session, agent_system_id: str | None = None
) -> AgentSystemVersionRecord:
    system_id = agent_system_id or default_agent_system(session).id
    version = (
        session.query(AgentSystemVersionRecord)
        .filter_by(agent_system_id=system_id)
        .order_by(AgentSystemVersionRecord.version.desc())
        .first()
    )
    if version is None:
        raise LookupError("No agent system version exists")
    return version


def latest_prompt_version(session: Session, agent_system_id: str) -> PromptVersionRecord:
    system = session.get(AgentSystemRecord, agent_system_id)
    primary = (
        session.query(PromptRecord)
        .filter_by(
            agent_system_id=agent_system_id,
            key=f"{system.key}-system" if system is not None else "",
        )
        .first()
    )
    if primary is not None:
        primary_version = (
            session.query(PromptVersionRecord)
            .filter_by(prompt_id=primary.id)
            .order_by(PromptVersionRecord.version.desc())
            .first()
        )
        if primary_version is not None:
            return primary_version
    version = (
        session.query(PromptVersionRecord)
        .join(PromptRecord, PromptRecord.id == PromptVersionRecord.prompt_id)
        .filter(PromptRecord.agent_system_id == agent_system_id)
        .order_by(PromptVersionRecord.version.desc())
        .first()
    )
    if version is None:
        raise LookupError("No prompt version exists")
    return version


def resolve_graph_prompt_versions(
    session: Session,
    graph_version: AgentSystemVersionRecord,
    requested_version_ids: dict[str, str] | None = None,
) -> dict[str, PromptVersionRecord]:
    requested = requested_version_ids or {}
    prompt_keys = sorted(parse_graph_definition(graph_version.definition).prompt_keys())
    unknown_keys = sorted(set(requested) - set(prompt_keys))
    if unknown_keys:
        raise ValueError(
            "Prompt-version selections are not used by this graph: " + ", ".join(unknown_keys)
        )

    resolved: dict[str, PromptVersionRecord] = {}
    for prompt_key in prompt_keys:
        prompt = session.query(PromptRecord).filter_by(key=prompt_key).first()
        if prompt is None or prompt.agent_system_id != graph_version.agent_system_id:
            raise ValueError(f"Graph prompt key does not belong to this agent system: {prompt_key}")
        requested_id = requested.get(prompt_key)
        if requested_id:
            version = session.get(PromptVersionRecord, requested_id)
            if version is None:
                raise LookupError(f"Prompt version not found: {requested_id}")
            if version.prompt_id != prompt.id:
                raise ValueError(f"Prompt version selection does not match prompt key {prompt_key}")
        else:
            version = (
                session.query(PromptVersionRecord)
                .filter_by(prompt_id=prompt.id)
                .order_by(PromptVersionRecord.version.desc())
                .first()
            )
            if version is None:
                raise LookupError(f"No prompt version exists for prompt key {prompt_key}")
        resolved[prompt_key] = version
    return resolved


def agent_system_summary(session: Session, system: AgentSystemRecord) -> AgentSystemSummary:
    versions = (
        session.query(AgentSystemVersionRecord)
        .filter_by(agent_system_id=system.id)
        .order_by(AgentSystemVersionRecord.version.desc())
        .all()
    )
    spec = system_spec(system.key)
    return AgentSystemSummary(
        id=system.id,
        key=system.key,
        product_key=spec.product_key or system.key,
        flow_key=spec.flow_key,
        flow_name=spec.flow_name,
        name=system.name,
        description=system.description,
        versions=[_version_summary(item) for item in versions],
        default_model_ids=list(spec.default_model_ids),
        input_template=spec.input_template,
        dataset_editor=spec.dataset_editor,
        primary_metric=spec.primary_metric,
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
        agent_system_id=prompt.agent_system_id,
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


def _validate_graph_prompt_keys(
    session: Session,
    agent_system: AgentSystemRecord,
    definition: AgentGraphDefinition,
) -> None:
    prompt_keys = {node.prompt_key for node in definition.nodes if node.prompt_key is not None}
    if not prompt_keys:
        return
    prompts = session.query(PromptRecord).filter(PromptRecord.key.in_(prompt_keys)).all()
    owned_keys = {prompt.key for prompt in prompts if prompt.agent_system_id == agent_system.id}
    invalid = sorted(prompt_keys - owned_keys)
    if invalid:
        raise ValueError(
            "Graph prompt keys must belong to this agent system: " + ", ".join(invalid)
        )
