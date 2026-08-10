from collections.abc import Callable
from copy import deepcopy

from sqlalchemy import func
from sqlalchemy.orm import Session

from autoeval_api.agent_systems.portfolio_analyst.snapshots import (
    SYNTHETIC_INSUFFICIENT_SHARES_SNAPSHOT_ID,
    ensure_synthetic_portfolio_snapshots,
)
from autoeval_api.agent_systems.portfolio_query.definition import (
    PORTFOLIO_QUERY_GRAPH,
    PORTFOLIO_QUERY_INPUT_TEMPLATE,
    PORTFOLIO_QUERY_PROMPT,
)
from autoeval_api.agent_systems.portfolio_query.scoring import DATASET_KEY
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


def _dataset_items() -> list[tuple[dict, dict]]:
    eligible = deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE)
    insufficient_shares = deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE)
    insufficient_shares["snapshot_id"] = SYNTHETIC_INSUFFICIENT_SHARES_SNAPSHOT_ID
    stale_quotes = deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE)
    stale_quotes["market_context"]["quote_age_hours"] = 72
    return [
        (
            eligible,
            {
                "status": "candidates",
                "candidate_ids": ["candidate-001"],
                "market_data_fresh": True,
            },
        ),
        (
            insufficient_shares,
            {
                "status": "blocked",
                "candidate_ids": [],
                "market_data_fresh": True,
            },
        ),
        (
            stale_quotes,
            {
                "status": "needs_market_data",
                "candidate_ids": [],
                "market_data_fresh": False,
            },
        ),
    ]


def ensure_seed_data(
    session: Session,
) -> tuple[AgentSystemVersionRecord, PromptVersionRecord, DatasetVersionRecord]:
    snapshot_owner = _get_or_create_snapshot_owner(session)
    ensure_synthetic_portfolio_snapshots(session, snapshot_owner)
    system = _get_or_create_system(session)
    prompt = _get_or_create_prompt(session, system)
    prompt_version = _latest_prompt_version(session, prompt)
    _ensure_node_prompt_version(session, system)
    graph_version = _latest_graph_version(session, system)
    dataset = _get_or_create_dataset(session, system)
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
        trace_exists = (
            session.query(TraceRecord).filter_by(agent_system_version_id=graph_version.id).first()
        )
        if trace_exists is None:
            await runner.run(
                session,
                RunSelection(
                    graph_version,
                    prompt_version,
                    "mock/portfolio-analyst",
                    "portfolio-query",
                    prompt_versions,
                ),
                deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE),
            )
        eval_exists = (
            session.query(EvalRunRecord).filter_by(agent_system_version_id=graph_version.id).first()
        )
        if eval_exists is None:
            service = EvaluationService(session_factory, runner, scoring_registry)
            run = service.create_run(
                session,
                final_version,
                graph_version,
                prompt_version,
                ["mock/portfolio-analyst", "mock/portfolio-fast"],
                prompt_versions,
            )
            await service.execute(run.id)
    finally:
        session.close()


def _get_or_create_system(session: Session) -> AgentSystemRecord:
    description = (
        "Answer questions over an immutable server-resolved portfolio snapshot using "
        "deterministic facts, supplied market data, and policy checks."
    )
    record = session.query(AgentSystemRecord).filter_by(key="portfolio-query").first()
    if record is None:
        record = AgentSystemRecord(
            key="portfolio-query",
            name="Investment Portfolio Q&A",
            description=description,
        )
        session.add(record)
        session.commit()
    elif record.description != description:
        record.description = description
        session.commit()
    return record


def _get_or_create_snapshot_owner(session: Session) -> AgentSystemRecord:
    description = (
        "Index portfolio context into an immutable snapshot and explain deterministic "
        "exposure, concentration, bucket, liquidity, and scenario analysis."
    )
    record = session.query(AgentSystemRecord).filter_by(key="portfolio-analyst").first()
    if record is None:
        record = AgentSystemRecord(
            key="portfolio-analyst",
            name="Investment Portfolio Analyst",
            description=description,
        )
        session.add(record)
        session.commit()
    elif record.description != description:
        record.description = description
        session.commit()
    return record


def _latest_graph_version(session: Session, system: AgentSystemRecord) -> AgentSystemVersionRecord:
    parsed = AgentGraphDefinition.model_validate(PORTFOLIO_QUERY_GRAPH)
    parsed.validate_references()
    content_hash = hash_json(parsed.model_dump(mode="json"))
    version = (
        session.query(AgentSystemVersionRecord)
        .filter_by(agent_system_id=system.id, content_hash=content_hash)
        .first()
    )
    return version or create_agent_version(session, system, PORTFOLIO_QUERY_GRAPH)


def _get_or_create_prompt(session: Session, system: AgentSystemRecord) -> PromptRecord:
    record = session.query(PromptRecord).filter_by(key="portfolio-query-system").first()
    if record is None:
        record = PromptRecord(
            agent_system_id=system.id,
            key="portfolio-query-system",
            name="Portfolio query system prompt",
            description="Grounded explanation of deterministic portfolio-query results.",
        )
        session.add(record)
        session.commit()
    return record


def _latest_prompt_version(session: Session, prompt: PromptRecord) -> PromptVersionRecord:
    content_hash = hash_text(PORTFOLIO_QUERY_PROMPT.strip())
    version = (
        session.query(PromptVersionRecord)
        .filter_by(prompt_id=prompt.id, content_hash=content_hash)
        .first()
    )
    return version or create_prompt_version(session, prompt, PORTFOLIO_QUERY_PROMPT)


def _ensure_node_prompt_version(
    session: Session,
    system: AgentSystemRecord,
) -> PromptVersionRecord:
    key = "portfolio-query-explanation"
    prompt = session.query(PromptRecord).filter_by(key=key).first()
    if prompt is None:
        prompt = PromptRecord(
            agent_system_id=system.id,
            key=key,
            name="Portfolio query explanation",
            description="Grounded explanation instructions for the portfolio query flow.",
        )
        session.add(prompt)
        session.commit()
    elif prompt.agent_system_id != system.id:
        raise ValueError(f"Seed prompt key belongs to another agent system: {key}")
    content_hash = hash_text(PORTFOLIO_QUERY_PROMPT.strip())
    version = (
        session.query(PromptVersionRecord)
        .filter_by(prompt_id=prompt.id, content_hash=content_hash)
        .first()
    )
    return version or create_prompt_version(session, prompt, PORTFOLIO_QUERY_PROMPT)


def _get_or_create_dataset(session: Session, system: AgentSystemRecord) -> DatasetRecord:
    record = session.query(DatasetRecord).filter_by(key=DATASET_KEY).first()
    if record is None:
        record = DatasetRecord(
            agent_system_id=system.id,
            key=DATASET_KEY,
            name="Portfolio query safety ground truth",
            description="Synthetic covered-call eligibility, abstention, and grounding cases.",
        )
        session.add(record)
        session.commit()
    return record


def _get_or_create_final_dataset(session: Session, dataset: DatasetRecord) -> DatasetVersionRecord:
    version = (
        session.query(DatasetVersionRecord)
        .filter_by(dataset_id=dataset.id, status=DatasetStatus.FINAL)
        .order_by(DatasetVersionRecord.version.desc())
        .first()
    )
    if version is not None and _is_current_dataset_version(session, version):
        return version
    next_version = (
        session.query(func.max(DatasetVersionRecord.version))
        .filter_by(dataset_id=dataset.id)
        .scalar()
        or 0
    ) + 1
    version = DatasetVersionRecord(
        dataset_id=dataset.id,
        version=next_version,
        status=DatasetStatus.DRAFT,
    )
    session.add(version)
    session.flush()
    session.add_all(
        DatasetItemRecord(dataset_version_id=version.id, input=input_value, expected=expected)
        for input_value, expected in _dataset_items()
    )
    session.flush()
    version.status = DatasetStatus.FINAL
    version.finalized_at = utc_now()
    session.commit()
    return version


def _is_current_dataset_version(session: Session, version: DatasetVersionRecord) -> bool:
    items = session.query(DatasetItemRecord).filter_by(dataset_version_id=version.id).all()
    expected_items = _dataset_items()
    return len(items) == len(expected_items) and all(
        any(item.input == input_value and item.expected == expected for item in items)
        for input_value, expected in expected_items
    )


def _ensure_draft_dataset(
    session: Session, dataset: DatasetRecord, final_version: DatasetVersionRecord
) -> None:
    draft = (
        session.query(DatasetVersionRecord)
        .filter_by(dataset_id=dataset.id, status=DatasetStatus.DRAFT)
        .order_by(DatasetVersionRecord.version.desc())
        .first()
    )
    if draft is None or draft.version < final_version.version:
        create_dataset_version(session, dataset, clone_from_version_id=final_version.id)
