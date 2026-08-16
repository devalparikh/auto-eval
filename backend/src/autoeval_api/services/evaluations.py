from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import update
from sqlalchemy.orm import Session

from autoeval_api.graph.definition import NodeResourceSelection, parse_graph_definition
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
from autoeval_api.services.node_resources import resolve_node_resource
from autoeval_api.services.scoring import MetricSuite, ScoringRegistry, default_scoring_registry
from autoeval_api.services.versioning import resolve_graph_prompt_versions


@dataclass(frozen=True)
class EvaluationContext:
    run: EvalRunRecord
    items: list[DatasetItemRecord]
    graph_version: AgentSystemVersionRecord
    prompt_version: PromptVersionRecord
    prompt_versions: dict[str, PromptVersionRecord]
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
        prompt_versions: dict[str, PromptVersionRecord] | None = None,
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
        if prompt_versions is None:
            prompt_versions = resolve_graph_prompt_versions(session, graph_version)
        definition = parse_graph_definition(graph_version.definition)
        if set(prompt_versions) != definition.prompt_keys():
            raise ValueError("Every graph prompt key must resolve to exactly one prompt version")
        for prompt_key, version in prompt_versions.items():
            selected_prompt = session.get(PromptRecord, version.prompt_id)
            if (
                selected_prompt is None
                or selected_prompt.key != prompt_key
                or selected_prompt.agent_system_id != graph_version.agent_system_id
            ):
                raise ValueError(f"Invalid prompt version selection for {prompt_key}")
        for model_id in model_ids:
            self.runner.provider_registry.get_for_model(model_id)
        run = EvalRunRecord(
            status=RunStatus.QUEUED,
            dataset_version_id=dataset_version.id,
            agent_system_version_id=graph_version.id,
            prompt_version_id=prompt_version.id,
            prompt_version_ids={key: version.id for key, version in prompt_versions.items()},
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
        prompt_versions: dict[str, PromptVersionRecord] = {}
        for prompt_key, version_id in (run.prompt_version_ids or {}).items():
            selected = session.get(PromptVersionRecord, version_id)
            selected_prompt = (
                session.get(PromptRecord, selected.prompt_id) if selected is not None else None
            )
            if (
                selected is None
                or selected_prompt is None
                or selected_prompt.key != prompt_key
                or selected_prompt.agent_system_id != system.id
            ):
                raise RuntimeError(
                    f"Evaluation prompt version selection is no longer available: {prompt_key}"
                )
            prompt_versions[prompt_key] = selected
        return EvaluationContext(
            run=run,
            items=items,
            graph_version=graph_version,
            prompt_version=prompt_version,
            prompt_versions=prompt_versions,
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
            self._require_locked_runtime_inputs(context.graph_version, item)
            self._require_locked_node_resources(session, context.graph_version, item)
            trace = await self.runner.run(
                session,
                RunSelection(
                    context.graph_version,
                    context.prompt_version,
                    model_id,
                    context.agent_system_key,
                    context.prompt_versions,
                ),
                item.input,
                TraceContext(
                    origin_type=TraceOrigin.EVALUATION,
                    evaluation_run_id=context.run.id,
                    evaluation_dataset_item_id=item.id,
                ),
                runtime_input_snapshot_ids=item.runtime_input_snapshot_ids or {},
                node_resource_selections=item.node_resource_selections or {},
                capture_node_outputs=False,
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
    def _require_locked_runtime_inputs(
        graph_version: AgentSystemVersionRecord,
        item: DatasetItemRecord,
    ) -> None:
        definition = parse_graph_definition(graph_version.definition)
        locked_nodes = {
            node.id
            for node in definition.nodes
            if node.runtime_input_policy is not None
            and node.runtime_input_policy.evaluation_mode == "locked"
            and node.runtime_input_policy.required
        }
        missing = sorted(locked_nodes - set(item.runtime_input_snapshot_ids or {}))
        if not missing:
            return
        # Compatibility only for finalized Portfolio Query versions that predate
        # runtime-input artifacts and stored this one observation inline.
        legacy_node = definition.node("load_portfolio_market_data")
        if (
            set(missing) == {"load_portfolio_market_data"}
            and legacy_node is not None
            and legacy_node.runtime_input_policy is not None
            and legacy_node.runtime_input_policy.source == "options_chain"
            and isinstance(item.input.get("market_context"), dict)
        ):
            return
        raise RuntimeError(
            "Evaluation item is missing locked runtime-input snapshots for nodes: "
            + ", ".join(missing)
        )

    @staticmethod
    def _require_locked_node_resources(
        session: Session,
        graph_version: AgentSystemVersionRecord,
        item: DatasetItemRecord,
    ) -> None:
        policies = {
            node_id: policy
            for node_id, policy in parse_graph_definition(graph_version.definition)
            .resource_policies()
            .items()
            if policy.evaluation_mode == "locked"
        }
        required = {node_id for node_id, policy in policies.items() if policy.required}
        selected = item.node_resource_selections or {}
        unknown = sorted(set(selected) - set(policies))
        if unknown:
            raise RuntimeError(
                "Evaluation item selects resources for nodes without a policy: "
                + ", ".join(unknown)
            )
        missing = sorted(required - set(selected))
        if missing:
            raise RuntimeError(
                "Evaluation item is missing locked node resources for nodes: " + ", ".join(missing)
            )
        current = sorted(
            node_id for node_id in required if selected.get(node_id, {}).get("mode") != "locked"
        )
        if current:
            raise RuntimeError(
                "Evaluation node resources must lock exact snapshots for nodes: "
                + ", ".join(current)
            )
        system = session.get(AgentSystemRecord, graph_version.agent_system_id)
        if system is None:
            raise RuntimeError("Evaluation agent system is no longer available")
        for node_id, selection in selected.items():
            try:
                resolve_node_resource(
                    session,
                    consumer_system_key=system.key,
                    policy=policies[node_id],
                    selection=NodeResourceSelection.model_validate(selection),
                )
            except ValueError as error:
                raise RuntimeError(
                    f"Evaluation node resource is incompatible with graph policy: {node_id}"
                ) from error

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
        prompt_version_ids=run.prompt_version_ids or {},
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
