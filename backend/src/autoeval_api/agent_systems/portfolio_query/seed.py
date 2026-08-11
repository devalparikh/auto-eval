from collections.abc import Callable
from copy import deepcopy
from datetime import datetime

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
from autoeval_api.agent_systems.portfolio_query.runtime_fixtures import (
    ELIGIBLE_OPTIONS_PAYLOAD,
    ELIGIBLE_OPTIONS_PROVENANCE,
    STALE_OPTIONS_PAYLOAD,
    STALE_OPTIONS_PROVENANCE,
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
from autoeval_api.services.runtime_input_snapshots import create_runtime_input_snapshot
from autoeval_api.services.scoring import ScoringRegistry
from autoeval_api.services.versioning import (
    create_agent_version,
    create_prompt_version,
    hash_json,
    hash_text,
    resolve_graph_prompt_versions,
)


def _dataset_items(
    eligible_runtime_snapshot_id: str,
    stale_runtime_snapshot_id: str,
) -> list[tuple[dict, dict, dict[str, str]]]:
    eligible = deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE)
    insufficient_shares = deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE)
    insufficient_shares["snapshot_id"] = SYNTHETIC_INSUFFICIENT_SHARES_SNAPSHOT_ID
    stale_quotes = deepcopy(PORTFOLIO_QUERY_INPUT_TEMPLATE)
    return [
        (
            eligible,
            {
                "status": "candidates",
                "candidate_ids": ["candidate-001"],
                "market_data_fresh": True,
            },
            {"load_portfolio_market_data": eligible_runtime_snapshot_id},
        ),
        (
            insufficient_shares,
            {
                "status": "blocked",
                "candidate_ids": [],
                "market_data_fresh": True,
            },
            {"load_portfolio_market_data": eligible_runtime_snapshot_id},
        ),
        (
            stale_quotes,
            {
                "status": "needs_market_data",
                "candidate_ids": [],
                "market_data_fresh": False,
            },
            {"load_portfolio_market_data": stale_runtime_snapshot_id},
        ),
    ]


def ensure_seed_data(
    session: Session,
) -> tuple[AgentSystemVersionRecord, PromptVersionRecord, DatasetVersionRecord]:
    snapshot_owner = _get_or_create_snapshot_owner(session)
    ensure_synthetic_portfolio_snapshots(session, snapshot_owner)
    system = _get_or_create_system(session)
    eligible_runtime_snapshot, stale_runtime_snapshot = _ensure_runtime_input_snapshots(
        session, system
    )
    prompt = _get_or_create_prompt(session, system)
    prompt_version = _latest_prompt_version(session, prompt)
    _ensure_node_prompt_version(session, system)
    graph_version = _latest_graph_version(session, system)
    dataset = _get_or_create_dataset(session, system)
    final_version = _get_or_create_final_dataset(
        session,
        dataset,
        eligible_runtime_snapshot.id,
        stale_runtime_snapshot.id,
    )
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


def _ensure_runtime_input_snapshots(session: Session, system: AgentSystemRecord):
    eligible = _create_seed_runtime_input_snapshot(
        session,
        system,
        "Synthetic eligible options observation",
        ELIGIBLE_OPTIONS_PAYLOAD,
        ELIGIBLE_OPTIONS_PROVENANCE,
    )
    stale = _create_seed_runtime_input_snapshot(
        session,
        system,
        "Synthetic stale options observation",
        STALE_OPTIONS_PAYLOAD,
        STALE_OPTIONS_PROVENANCE,
    )
    return eligible, stale


def _create_seed_runtime_input_snapshot(
    session: Session,
    system: AgentSystemRecord,
    label: str,
    payload: dict,
    provenance: dict,
):
    return create_runtime_input_snapshot(
        session,
        system,
        source_trace_id=None,
        node_id="load_portfolio_market_data",
        source_key="options_chain",
        schema_version=1,
        label=label,
        observed_at=datetime.fromisoformat(str(provenance["as_of"]).replace("Z", "+00:00")),
        fetched_at=datetime.fromisoformat(str(provenance["fetched_at"]).replace("Z", "+00:00")),
        provider=str(provenance["provider"]),
        source_kind="seed_fixture",
        is_synthetic=True,
        payload=deepcopy(payload),
        provenance=deepcopy(provenance),
    )


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


def _get_or_create_final_dataset(
    session: Session,
    dataset: DatasetRecord,
    eligible_runtime_snapshot_id: str,
    stale_runtime_snapshot_id: str,
) -> DatasetVersionRecord:
    version = (
        session.query(DatasetVersionRecord)
        .filter_by(dataset_id=dataset.id, status=DatasetStatus.FINAL)
        .order_by(DatasetVersionRecord.version.desc())
        .first()
    )
    if version is not None and _is_current_dataset_version(
        session,
        version,
        eligible_runtime_snapshot_id,
        stale_runtime_snapshot_id,
    ):
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
        DatasetItemRecord(
            dataset_version_id=version.id,
            input=input_value,
            expected=expected,
            runtime_input_snapshot_ids=runtime_input_snapshot_ids,
        )
        for input_value, expected, runtime_input_snapshot_ids in _dataset_items(
            eligible_runtime_snapshot_id,
            stale_runtime_snapshot_id,
        )
    )
    session.flush()
    version.status = DatasetStatus.FINAL
    version.finalized_at = utc_now()
    session.commit()
    return version


def _is_current_dataset_version(
    session: Session,
    version: DatasetVersionRecord,
    eligible_runtime_snapshot_id: str,
    stale_runtime_snapshot_id: str,
) -> bool:
    items = session.query(DatasetItemRecord).filter_by(dataset_version_id=version.id).all()
    expected_items = _dataset_items(
        eligible_runtime_snapshot_id,
        stale_runtime_snapshot_id,
    )
    return len(items) == len(expected_items) and all(
        any(
            item.input == input_value
            and item.expected == expected
            and item.runtime_input_snapshot_ids == runtime_ids
            for item in items
        )
        for input_value, expected, runtime_ids in expected_items
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
