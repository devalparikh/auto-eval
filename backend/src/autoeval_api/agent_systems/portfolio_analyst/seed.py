from collections.abc import Callable
from copy import deepcopy

from sqlalchemy.orm import Session

from autoeval_api.agent_systems.portfolio_analyst.definition import (
    PORTFOLIO_GRAPH,
    PORTFOLIO_INPUT_TEMPLATE,
    PORTFOLIO_PROMPT,
)
from autoeval_api.agent_systems.portfolio_analyst.scoring import DATASET_KEY
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
from autoeval_api.services.datasets import create_dataset_version
from autoeval_api.services.evaluations import EvaluationService
from autoeval_api.services.scoring import ScoringRegistry
from autoeval_api.services.versioning import create_agent_version, create_prompt_version


def _dataset_items() -> list[tuple[dict, dict]]:
    complete = deepcopy(PORTFOLIO_INPUT_TEMPLATE)
    balanced = deepcopy(PORTFOLIO_INPUT_TEMPLATE)
    balanced["holdings"] = [
        {
            "symbol": symbol,
            "asset_class": asset_class,
            "bucket": bucket,
            "weight": 0.25,
            "exposures": {asset_class: 1.0},
        }
        for symbol, asset_class, bucket in (
            ("US_MARKET", "us_equity", "core"),
            ("INTL_MARKET", "international_equity", "diversifier"),
            ("BONDS", "fixed_income", "stability"),
            ("CASH", "cash", "liquidity"),
        )
    ]
    balanced["scenarios"] = []
    incomplete = deepcopy(PORTFOLIO_INPUT_TEMPLATE)
    incomplete["profile"].pop("liquidity_need")
    return [
        (
            complete,
            {
                "analysis_ready": True,
                "top_holding_symbol": "BROAD_MARKET",
                "concentration_flag_count": 2,
                "scenario_count": 1,
            },
        ),
        (
            balanced,
            {
                "analysis_ready": True,
                "top_holding_symbol": "US_MARKET",
                "concentration_flag_count": 4,
                "scenario_count": 0,
            },
        ),
        (incomplete, {"analysis_ready": False}),
    ]


def ensure_seed_data(
    session: Session,
) -> tuple[AgentSystemVersionRecord, PromptVersionRecord, DatasetVersionRecord]:
    system = _get_or_create_system(session)
    graph_version = _latest_graph_version(session, system)
    prompt = _get_or_create_prompt(session, system)
    prompt_version = _latest_prompt_version(session, prompt)
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
                    "portfolio-analyst",
                ),
                deepcopy(PORTFOLIO_INPUT_TEMPLATE),
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
            )
            await service.execute(run.id)
    finally:
        session.close()


def _get_or_create_system(session: Session) -> AgentSystemRecord:
    record = session.query(AgentSystemRecord).filter_by(key="portfolio-analyst").first()
    if record is None:
        record = AgentSystemRecord(
            key="portfolio-analyst",
            name="Investment Portfolio Analyst",
            description=(
                "Collect investor context and explain deterministic portfolio exposures "
                "without prescribing trades."
            ),
        )
        session.add(record)
        session.commit()
    return record


def _latest_graph_version(session: Session, system: AgentSystemRecord) -> AgentSystemVersionRecord:
    version = (
        session.query(AgentSystemVersionRecord)
        .filter_by(agent_system_id=system.id)
        .order_by(AgentSystemVersionRecord.version.desc())
        .first()
    )
    return version or create_agent_version(session, system, PORTFOLIO_GRAPH)


def _get_or_create_prompt(session: Session, system: AgentSystemRecord) -> PromptRecord:
    record = session.query(PromptRecord).filter_by(key="portfolio-analyst-system").first()
    if record is None:
        record = PromptRecord(
            agent_system_id=system.id,
            key="portfolio-analyst-system",
            name="Portfolio analyst system prompt",
            description="Grounded explanation and financial-safety instructions.",
        )
        session.add(record)
        session.commit()
    return record


def _latest_prompt_version(session: Session, prompt: PromptRecord) -> PromptVersionRecord:
    version = (
        session.query(PromptVersionRecord)
        .filter_by(prompt_id=prompt.id)
        .order_by(PromptVersionRecord.version.desc())
        .first()
    )
    return version or create_prompt_version(session, prompt, PORTFOLIO_PROMPT)


def _get_or_create_dataset(session: Session, system: AgentSystemRecord) -> DatasetRecord:
    record = session.query(DatasetRecord).filter_by(key=DATASET_KEY).first()
    if record is None:
        record = DatasetRecord(
            agent_system_id=system.id,
            key=DATASET_KEY,
            name="Portfolio analysis ground truth",
            description="Synthetic invariant checks for portfolio intake and calculations.",
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
        DatasetItemRecord(dataset_version_id=version.id, input=input_value, expected=expected)
        for input_value, expected in _dataset_items()
    )
    session.flush()
    version.status = DatasetStatus.FINAL
    version.finalized_at = utc_now()
    session.commit()
    return version


def _ensure_draft_dataset(
    session: Session, dataset: DatasetRecord, final_version: DatasetVersionRecord
) -> None:
    draft = (
        session.query(DatasetVersionRecord)
        .filter_by(dataset_id=dataset.id, status=DatasetStatus.DRAFT)
        .first()
    )
    if draft is None:
        create_dataset_version(session, dataset, clone_from_version_id=final_version.id)
