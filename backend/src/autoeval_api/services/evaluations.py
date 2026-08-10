from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import update
from sqlalchemy.orm import Session

from autoeval_api.graph.runner import AgentGraphRunner, RunSelection, TraceContext
from autoeval_api.models import (
    AgentSystemRecord,
    AgentSystemVersionRecord,
    DatasetItemRecord,
    DatasetRecord,
    DatasetStatus,
    DatasetVersionRecord,
    EvalItemResultRecord,
    EvalModelResultRecord,
    EvalRunRecord,
    PromptRecord,
    PromptVersionRecord,
    RunStatus,
    TraceOrigin,
    TraceRecord,
    utc_now,
)
from autoeval_api.schemas import (
    EvalItemResultResponse,
    EvalModelResultResponse,
    EvalRunResponse,
)
from autoeval_api.services.scoring import MetricSuite, ScoringRegistry, default_scoring_registry


@dataclass(frozen=True)
class EvaluationContext:
    run: EvalRunRecord
    items: list[DatasetItemRecord]
    graph_version: AgentSystemVersionRecord
    prompt_version: PromptVersionRecord
    metric_suite: MetricSuite
    agent_system_key: str


class EvaluationService:
    def __init__(
        self,
        session_factory: Callable[[], Session],
        runner: AgentGraphRunner,
        scoring_registry: ScoringRegistry | None = None,
    ) -> None:
        self.session_factory = session_factory
        self.runner = runner
        self.scoring_registry = scoring_registry or default_scoring_registry()

    def create_run(
        self,
        session: Session,
        dataset_version: DatasetVersionRecord,
        graph_version: AgentSystemVersionRecord,
        prompt_version: PromptVersionRecord,
        model_ids: list[str],
    ) -> EvalRunRecord:
        if dataset_version.status != DatasetStatus.FINAL:
            raise ValueError("Only final dataset versions can be evaluated")
        dataset = session.get(DatasetRecord, dataset_version.dataset_id)
        prompt = session.get(PromptRecord, prompt_version.prompt_id)
        if dataset is None or prompt is None:
            raise ValueError("Evaluation selection is no longer available")
        selected_systems = {
            dataset.agent_system_id,
            graph_version.agent_system_id,
            prompt.agent_system_id,
        }
        if len(selected_systems) != 1:
            raise ValueError("Dataset, graph, and prompt must belong to the same agent system")
        for model_id in model_ids:
            self.runner.provider_registry.get_for_model(model_id)
        run = EvalRunRecord(
            status=RunStatus.QUEUED,
            dataset_version_id=dataset_version.id,
            agent_system_version_id=graph_version.id,
            prompt_version_id=prompt_version.id,
            model_ids=list(dict.fromkeys(model_ids)),
        )
        session.add(run)
        session.commit()
        session.refresh(run)
        return run

    async def execute(self, run_id: str) -> None:
        session = self.session_factory()
        try:
            claimed = session.execute(
                update(EvalRunRecord)
                .where(EvalRunRecord.id == run_id, EvalRunRecord.status == RunStatus.QUEUED)
                .values(status=RunStatus.RUNNING)
            ).rowcount
            session.commit()
            if not claimed:
                return
            context = self._load_context(session, run_id)
            if context is None:
                return
            for model_id in context.run.model_ids:
                await self._evaluate_model(session, context, model_id)
            context.run.status = RunStatus.COMPLETE
            context.run.completed_at = utc_now()
            session.add(context.run)
            session.commit()
        except Exception as error:
            self._mark_failed(session, run_id, error)
        finally:
            session.close()

    def _load_context(self, session: Session, run_id: str) -> EvaluationContext | None:
        run = session.get(EvalRunRecord, run_id)
        if run is None:
            return None
        items = (
            session.query(DatasetItemRecord)
            .filter_by(dataset_version_id=run.dataset_version_id)
            .order_by(DatasetItemRecord.created_at)
            .all()
        )
        graph_version = session.get(AgentSystemVersionRecord, run.agent_system_version_id)
        prompt_version = session.get(PromptVersionRecord, run.prompt_version_id)
        dataset_version = session.get(DatasetVersionRecord, run.dataset_version_id)
        dataset = (
            session.get(DatasetRecord, dataset_version.dataset_id)
            if dataset_version is not None
            else None
        )
        if graph_version is None or prompt_version is None or dataset is None:
            raise RuntimeError("Evaluation version selection is no longer available")
        system = session.get(AgentSystemRecord, graph_version.agent_system_id)
        if system is None:
            raise RuntimeError("Evaluation agent system is no longer available")
        return EvaluationContext(
            run=run,
            items=items,
            graph_version=graph_version,
            prompt_version=prompt_version,
            metric_suite=self.scoring_registry.for_dataset(dataset.key),
            agent_system_key=system.key,
        )

    async def _evaluate_model(
        self,
        session: Session,
        context: EvaluationContext,
        model_id: str,
    ) -> None:
        completed: list[tuple[DatasetItemRecord, TraceRecord]] = []
        # One SQLAlchemy session owns this local run, so item execution is deliberately serialized.
        for item in context.items:
            trace = await self.runner.run(
                session,
                RunSelection(
                    context.graph_version,
                    context.prompt_version,
                    model_id,
                    context.agent_system_key,
                ),
                item.input,
                TraceContext(
                    origin_type=TraceOrigin.EVALUATION,
                    evaluation_run_id=context.run.id,
                    evaluation_dataset_item_id=item.id,
                ),
            )
            if trace.status != RunStatus.COMPLETE:
                raise RuntimeError(trace.error or "Agent run failed")
            completed.append((item, trace))
            actual = trace.output or {}
            session.add(
                EvalItemResultRecord(
                    eval_run_id=context.run.id,
                    dataset_item_id=item.id,
                    model_id=model_id,
                    trace_id=trace.id,
                    expected=item.expected,
                    actual=actual,
                    scores=context.metric_suite.score_item(item.expected, actual),
                )
            )
            session.commit()
        self._store_model_results(session, context, model_id, completed)

    @staticmethod
    def _mark_failed(session: Session, run_id: str, error: Exception) -> None:
        session.rollback()
        run = session.get(EvalRunRecord, run_id)
        if run is None:
            return
        run.status = RunStatus.FAILED
        run.error = (str(error).strip() or error.__class__.__name__)[:2000]
        run.completed_at = utc_now()
        session.add(run)
        session.commit()

    @staticmethod
    def _store_model_results(
        session: Session,
        context: EvaluationContext,
        model_id: str,
        completed: list[tuple[DatasetItemRecord, TraceRecord]],
    ) -> None:
        expected_items: list[dict[str, Any]] = []
        actual_items: list[dict[str, Any]] = []
        latencies: list[float] = []
        costs: list[float] = []
        for item, trace in completed:
            actual = trace.output or {}
            expected_items.append(item.expected)
            actual_items.append(actual)
            latencies.append(trace.latency_ms)
            costs.append(trace.cost_usd)
        session.add(
            EvalModelResultRecord(
                eval_run_id=context.run.id,
                model_id=model_id,
                metrics=context.metric_suite.aggregate(
                    expected_items, actual_items, latencies, costs
                ),
            )
        )
        session.commit()


def list_eval_runs(
    session: Session,
    dataset_version_id: str | None = None,
    agent_system_version_id: str | None = None,
    prompt_version_id: str | None = None,
    limit: int = 100,
) -> list[EvalRunRecord]:
    query = session.query(EvalRunRecord)
    if dataset_version_id:
        query = query.filter_by(dataset_version_id=dataset_version_id)
    if agent_system_version_id:
        query = query.filter_by(agent_system_version_id=agent_system_version_id)
    if prompt_version_id:
        query = query.filter_by(prompt_version_id=prompt_version_id)
    return query.order_by(EvalRunRecord.created_at.desc()).limit(limit).all()


def eval_run_response(
    session: Session, run: EvalRunRecord, include_items: bool = False
) -> EvalRunResponse:
    results = session.query(EvalModelResultRecord).filter_by(eval_run_id=run.id).all()
    item_results = (
        session.query(EvalItemResultRecord).filter_by(eval_run_id=run.id).all()
        if include_items
        else []
    )
    return EvalRunResponse(
        id=run.id,
        status=run.status,
        dataset_version_id=run.dataset_version_id,
        agent_system_version_id=run.agent_system_version_id,
        prompt_version_id=run.prompt_version_id,
        model_ids=run.model_ids,
        error=run.error,
        created_at=run.created_at,
        completed_at=run.completed_at,
        results=[
            EvalModelResultResponse.model_validate(item, from_attributes=True) for item in results
        ],
        item_results=[
            EvalItemResultResponse.model_validate(item, from_attributes=True)
            for item in item_results
        ],
    )
