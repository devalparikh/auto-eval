from collections.abc import Callable

from sqlalchemy.orm import Session

from autoeval_api.agent_systems.incident_triage.definition import (
    INCIDENT_CLASSIFICATION_PROMPT,
    INCIDENT_DRAFT_RESPONSE_PROMPT,
    INCIDENT_GRAPH,
    INCIDENT_PROMPT,
)
from autoeval_api.agent_systems.incident_triage.scoring import DATASET_KEY
from autoeval_api.graph.runner import AgentGraphRunner, RunSelection
from autoeval_api.models import (
    AgentSystemRecord,
    AgentSystemVersionRecord,
    DatasetItemRecord,
    DatasetRecord,
    DatasetStatus,
    DatasetVersionRecord,
    EvalRunRecord,
    PromptRecord,
    PromptVersionRecord,
    TraceRecord,
    utc_now,
)
from autoeval_api.schemas import AgentGraphDefinition
from autoeval_api.services.datasets import create_dataset_version
from autoeval_api.services.evaluations import EvaluationService
from autoeval_api.services.scoring import ScoringRegistry
from autoeval_api.services.versioning import (
    create_agent_version,
    create_prompt_version,
    hash_json,
    hash_text,
    resolve_graph_prompt_versions,
)

DATASET_ITEMS = [
    (
        {
            "is_synthetic": True,
            "text": "Production API is returning 503 for every customer in us-east.",
            "service": "public-api",
            "customer_tier": "enterprise",
        },
        {"severity": "high", "route": "platform", "requires_human": True},
    ),
    (
        {
            "is_synthetic": True,
            "text": (
                "An access token was leaked in a public repository and used without authorization."
            ),
            "service": "identity",
            "customer_tier": "enterprise",
        },
        {"severity": "critical", "route": "security", "requires_human": True},
    ),
    (
        {
            "is_synthetic": True,
            "text": "Checkout payment attempts are failing after the gateway release.",
            "service": "checkout",
            "customer_tier": "standard",
        },
        {"severity": "high", "route": "payments", "requires_human": True},
    ),
    (
        {
            "is_synthetic": True,
            "text": "Customer records appear corrupt and recent invoices are missing.",
            "service": "ledger",
            "customer_tier": "enterprise",
        },
        {"severity": "critical", "route": "data", "requires_human": True},
    ),
    (
        {
            "is_synthetic": True,
            "text": "A customer needs help changing the email address on their profile.",
            "service": "accounts",
            "customer_tier": "standard",
        },
        {"severity": "medium", "route": "support", "requires_human": False},
    ),
    (
        {
            "is_synthetic": True,
            "text": "The dashboard is unavailable for customers in Europe.",
            "service": "dashboard",
            "customer_tier": "standard",
        },
        {"severity": "high", "route": "platform", "requires_human": True},
    ),
]


def ensure_seed_data(
    session: Session,
) -> tuple[AgentSystemVersionRecord, PromptVersionRecord, DatasetVersionRecord]:
    agent_system = _get_or_create_agent_system(session)
    prompt = _get_or_create_prompt(session, agent_system)
    prompt_version = _latest_prompt_version(session, prompt)
    _ensure_node_prompt_versions(session, agent_system)
    graph_version = _latest_graph_version(session, agent_system)
    dataset = _get_or_create_dataset(session, agent_system)
    final_version = _get_or_create_final_dataset(session, dataset)
    _ensure_draft_dataset(session, dataset, final_version)
    return graph_version, prompt_version, final_version


async def ensure_demo_runs(
    session_factory: Callable[[], Session],
    runner: AgentGraphRunner,
    scoring_registry: ScoringRegistry,
) -> None:
    session = session_factory()
    try:
        graph_version, prompt_version, final_version = ensure_seed_data(session)
        prompt_versions = resolve_graph_prompt_versions(session, graph_version)
        if session.query(TraceRecord).count() == 0:
            await runner.run(
                session,
                RunSelection(
                    graph_version,
                    prompt_version,
                    "mock/incident-specialist",
                    "incident-triage",
                    prompt_versions,
                ),
                {
                    "is_synthetic": True,
                    "text": "The public API is down for enterprise customers after deployment.",
                    "service": "public-api",
                    "customer_tier": "enterprise",
                },
            )
        if session.query(EvalRunRecord).count() == 0:
            service = EvaluationService(session_factory, runner, scoring_registry)
            run = service.create_run(
                session,
                final_version,
                graph_version,
                prompt_version,
                ["mock/incident-specialist", "mock/incident-fast"],
                prompt_versions,
            )
            await service.execute(run.id)
    finally:
        session.close()


def _get_or_create_agent_system(session: Session) -> AgentSystemRecord:
    record = session.query(AgentSystemRecord).filter_by(key="incident-triage").first()
    if record is None:
        record = AgentSystemRecord(
            key="incident-triage",
            name="Incident triage",
            description=(
                "Classify operational incidents, apply routing policy, and draft a response."
            ),
        )
        session.add(record)
        session.commit()
    return record


def _latest_graph_version(session: Session, system: AgentSystemRecord) -> AgentSystemVersionRecord:
    parsed = AgentGraphDefinition.model_validate(INCIDENT_GRAPH)
    parsed.validate_references()
    content_hash = hash_json(parsed.model_dump(mode="json"))
    version = (
        session.query(AgentSystemVersionRecord)
        .filter_by(agent_system_id=system.id, content_hash=content_hash)
        .first()
    )
    return version or create_agent_version(session, system, INCIDENT_GRAPH)


def _get_or_create_prompt(session: Session, agent_system: AgentSystemRecord) -> PromptRecord:
    record = session.query(PromptRecord).filter_by(key="incident-triage-system").first()
    if record is None:
        record = PromptRecord(
            agent_system_id=agent_system.id,
            key="incident-triage-system",
            name="Incident triage system prompt",
            description="Shared instructions used by the LLM nodes in the incident graph.",
        )
        session.add(record)
        session.commit()
    elif record.agent_system_id != agent_system.id:
        record.agent_system_id = agent_system.id
        session.commit()
    return record


def _latest_prompt_version(session: Session, prompt: PromptRecord) -> PromptVersionRecord:
    version = (
        session.query(PromptVersionRecord)
        .filter_by(prompt_id=prompt.id)
        .order_by(PromptVersionRecord.version.desc())
        .first()
    )
    return version or create_prompt_version(session, prompt, INCIDENT_PROMPT)


def _ensure_node_prompt_versions(
    session: Session,
    agent_system: AgentSystemRecord,
) -> dict[str, PromptVersionRecord]:
    definitions = (
        (
            "incident-triage-classification",
            "Incident classification",
            "Classification-only instructions for the incident graph.",
            INCIDENT_CLASSIFICATION_PROMPT,
        ),
        (
            "incident-triage-draft-response",
            "Incident draft response",
            "Response-drafting instructions for the incident graph.",
            INCIDENT_DRAFT_RESPONSE_PROMPT,
        ),
    )
    versions: dict[str, PromptVersionRecord] = {}
    for key, name, description, content in definitions:
        prompt = session.query(PromptRecord).filter_by(key=key).first()
        if prompt is None:
            prompt = PromptRecord(
                agent_system_id=agent_system.id,
                key=key,
                name=name,
                description=description,
            )
            session.add(prompt)
            session.commit()
        elif prompt.agent_system_id != agent_system.id:
            raise ValueError(f"Seed prompt key belongs to another agent system: {key}")
        content_hash = hash_text(content.strip())
        version = (
            session.query(PromptVersionRecord)
            .filter_by(prompt_id=prompt.id, content_hash=content_hash)
            .first()
        )
        versions[key] = version or create_prompt_version(session, prompt, content)
    return versions


def _get_or_create_dataset(session: Session, agent_system: AgentSystemRecord) -> DatasetRecord:
    record = session.query(DatasetRecord).filter_by(key=DATASET_KEY).first()
    if record is None:
        record = DatasetRecord(
            agent_system_id=agent_system.id,
            key=DATASET_KEY,
            name="Incident triage ground truth",
            description="Reviewed severity and routing labels for incident reports.",
        )
        session.add(record)
        session.commit()
    elif record.agent_system_id != agent_system.id:
        record.agent_system_id = agent_system.id
        session.commit()
    return record


def _get_or_create_final_dataset(session: Session, dataset: DatasetRecord) -> DatasetVersionRecord:
    version = (
        session.query(DatasetVersionRecord)
        .filter_by(dataset_id=dataset.id, status=DatasetStatus.FINAL)
        .order_by(DatasetVersionRecord.version.desc())
        .first()
    )
    if version is not None:
        return version

    version = DatasetVersionRecord(
        dataset_id=dataset.id,
        version=1,
        status=DatasetStatus.DRAFT,
    )
    session.add(version)
    session.flush()
    session.add_all(
        DatasetItemRecord(dataset_version_id=version.id, input=input_payload, expected=expected)
        for input_payload, expected in DATASET_ITEMS
    )
    session.flush()
    version.status = DatasetStatus.FINAL
    version.finalized_at = utc_now()
    session.commit()
    return version


def _ensure_draft_dataset(
    session: Session, dataset: DatasetRecord, final_version: DatasetVersionRecord
) -> None:
    draft_exists = (
        session.query(DatasetVersionRecord)
        .filter_by(dataset_id=dataset.id, status=DatasetStatus.DRAFT)
        .first()
    )
    if draft_exists is None:
        create_dataset_version(session, dataset, clone_from_version_id=final_version.id)
