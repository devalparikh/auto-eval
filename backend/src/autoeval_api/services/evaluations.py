import asyncio
import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import func, update
from sqlalchemy.orm import Session

from autoeval_api.agent_systems.registry import system_plugins
from autoeval_api.config import Settings, get_settings
from autoeval_api.graph.definition import NodeResourceSelection, parse_graph_definition
from autoeval_api.graph.runner import AgentGraphRunner, RunSelection, TraceContext
from autoeval_api.inference.budget import InferenceBudget
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
    EvaluationAdmissionRecord,
    PromptRecord,
    PromptVersionRecord,
    RunStatus,
    TraceOrigin,
    TraceRecord,
    format_error_for_storage,
    utc_now,
)
from autoeval_api.redaction import redact_payload
from autoeval_api.schemas import (
    EvalItemResultResponse,
    EvalModelResultResponse,
    EvalRunResponse,
)
from autoeval_api.services.datasets import dataset_content_revision, finalize_dataset_version
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
    budget: InferenceBudget


class EvaluationConflict(ValueError):
    pass


class EvaluationLimitExceeded(ValueError):
    pass


class EvaluationService:
    def __init__(
        self,
        session_factory: Callable[[], Session],
        runner: AgentGraphRunner,
        scoring_registry: ScoringRegistry | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.session_factory = session_factory
        self.runner = runner
        self.scoring_registry = scoring_registry or default_scoring_registry()
        self.settings = settings or get_settings()
        # A benchmark starts one run per graph version. SQLite takes one writer and every
        # run shares this event loop, so queued runs wait their turn instead of contending.
        self._execution_lock = asyncio.Lock()

    def _limits(self) -> dict[str, int | float]:
        return {
            "max_calls": self.settings.evaluation_max_provider_calls,
            "max_tokens": self.settings.evaluation_max_tokens,
            "max_cost_usd": self.settings.evaluation_max_cost_usd,
        }

    def _require_admission(self, session: Session, item_count: int, graph, model_ids) -> None:
        active = session.query(EvalRunRecord).filter(
            EvalRunRecord.status.in_([RunStatus.QUEUED, RunStatus.RUNNING])
        )
        if active.count() >= self.settings.evaluation_max_pending_runs:
            raise EvaluationLimitExceeded("Too many pending evaluations; wait for a run to finish")
        if item_count > self.settings.evaluation_max_items:
            raise EvaluationLimitExceeded("Evaluation dataset exceeds the configured item limit")
        nodes = parse_graph_definition(graph.definition).nodes
        calls = item_count * len(set(model_ids)) * sum(node.kind == "llm" for node in nodes)
        if calls > self.settings.evaluation_max_provider_calls:
            raise EvaluationLimitExceeded("Evaluation exceeds the configured provider-call limit")
        # Reserve each active run's entire dollar allowance. The database lock
        # makes concurrent processes see reservations before admitting more work.
        reserved = sum(
            (run.limits or {}).get("max_cost_usd", self.settings.evaluation_max_cost_usd)
            for run in active.all()
        )
        spent = (
            session.query(func.coalesce(func.sum(TraceRecord.cost_usd), 0))
            .filter(
                TraceRecord.started_at >= utc_now() - timedelta(days=1),
                TraceRecord.evaluation_run_id.is_not(None),
                TraceRecord.evaluation_run_id.not_in(active.with_entities(EvalRunRecord.id)),
            )
            .scalar()
        )
        if spent + reserved + self.settings.evaluation_max_cost_usd > (
            self.settings.evaluation_daily_cost_usd
        ):
            raise EvaluationLimitExceeded("Evaluation daily spend allowance is exhausted")

    def create_run(
        self,
        session: Session,
        dataset_version: DatasetVersionRecord,
        graph_version: AgentSystemVersionRecord,
        prompt_version: PromptVersionRecord,
        model_ids: list[str],
        prompt_versions: dict[str, PromptVersionRecord] | None = None,
        *,
        finalize_dataset: bool = False,
        expected_dataset_revision: str | None = None,
        request_id: str | None = None,
    ) -> EvalRunRecord:
        """Finalize and enqueue atomically; a retry returns the original run."""
        try:
            # UPDATE takes a write lock on SQLite and a row lock on PostgreSQL.
            # It covers admission, retry lookup, finalization, and insertion.
            locked = session.execute(
                update(EvaluationAdmissionRecord)
                .where(EvaluationAdmissionRecord.id == 1)
                .values(id=1)
            ).rowcount
            if locked != 1:
                raise RuntimeError("Evaluation admission is unavailable; apply database migrations")
            if finalize_dataset or request_id:
                # Acquire SQLite's writer lock before reading the draft or retry key.
                # Final versions are never updated. Other databases lock the version row.
                if session.get_bind().dialect.name == "sqlite":
                    session.execute(
                        update(DatasetVersionRecord)
                        .where(
                            DatasetVersionRecord.id == dataset_version.id,
                            DatasetVersionRecord.status == DatasetStatus.DRAFT,
                        )
                        .values(status=DatasetVersionRecord.status)
                    )
                session.refresh(dataset_version, with_for_update=True)
            resolved_prompts = (
                prompt_versions
                if prompt_versions is not None
                else resolve_graph_prompt_versions(session, graph_version)
            )
            request_hash = hashlib.sha256(
                json.dumps(
                    {
                        "dataset": dataset_version.id,
                        "graph": graph_version.id,
                        "prompt": prompt_version.id,
                        "prompts": {key: value.id for key, value in resolved_prompts.items()},
                        "models": sorted(set(model_ids)),
                        "finalize": finalize_dataset,
                        "revision": expected_dataset_revision,
                    },
                    sort_keys=True,
                ).encode()
            ).hexdigest()
            if request_id:
                existing = session.query(EvalRunRecord).filter_by(request_id=request_id).first()
                if existing is not None:
                    if existing.request_hash != request_hash:
                        raise EvaluationConflict(
                            "This benchmark request was already used with different inputs."
                        )
                    session.commit()
                    return existing
            item_count = (
                session.query(DatasetItemRecord)
                .filter_by(dataset_version_id=dataset_version.id)
                .count()
            )
            self._require_admission(session, item_count, graph_version, model_ids)
            if finalize_dataset:
                if not expected_dataset_revision:
                    raise EvaluationConflict("Review the dataset before finalizing it.")
                items = (
                    session.query(DatasetItemRecord)
                    .filter_by(dataset_version_id=dataset_version.id)
                    .populate_existing()
                    .all()
                )
                if dataset_content_revision(items) != expected_dataset_revision:
                    raise EvaluationConflict(
                        "The dataset changed since you loaded it. "
                        "Refresh and review the dataset before starting the benchmark."
                    )
                if not items:
                    raise ValueError("Add at least one example before starting a benchmark.")
                system = session.get(AgentSystemRecord, graph_version.agent_system_id)
                if system is None:
                    raise ValueError("Evaluation agent system is no longer available")
                for item in items:
                    self._require_locked_runtime_inputs(graph_version, item, system.key)
                    self._require_locked_node_resources(session, graph_version, item)
                dataset = session.get(DatasetRecord, dataset_version.dataset_id)
                if dataset is None:
                    raise ValueError("Evaluation dataset is no longer available")
                self.scoring_registry.for_dataset(dataset.key)
                if dataset_version.status == DatasetStatus.DRAFT:
                    finalize_dataset_version(session, dataset_version, commit=False)
            run = self._create_run(
                session, dataset_version, graph_version, prompt_version, model_ids, resolved_prompts
            )
            run.request_id = request_id
            run.limits = self._limits()
            run.request_hash = request_hash if request_id else None
            session.commit()
            session.refresh(run)
            return run
        except Exception:
            session.rollback()
            raise

    def _create_run(
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
        return run

    async def execute(self, run_id: str) -> None:
        async with self._execution_lock:
            await self._execute(run_id)

    async def _execute(self, run_id: str) -> None:
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
            budget=InferenceBudget(
                **{
                    key: min(value, (run.limits or {}).get(key, value))
                    for key, value in self._limits().items()
                }
            ),
        )

    async def _evaluate_model(
        self,
        session: Session,
        context: EvaluationContext,
        model_id: str,
    ) -> None:
        completed: list[tuple[DatasetItemRecord, TraceRecord, dict[str, Any]]] = []
        # One SQLAlchemy session owns this local run, so item execution is deliberately serialized.
        for item in context.items:
            actual: dict[str, Any] = {}

            def capture_output(output: dict[str, Any]) -> None:
                nonlocal actual
                actual = output

            self._require_locked_runtime_inputs(
                context.graph_version, item, context.agent_system_key
            )
            self._require_locked_node_resources(session, context.graph_version, item)
            trace = await self.runner.run(
                session,
                RunSelection(
                    context.graph_version,
                    context.prompt_version,
                    model_id,
                    context.agent_system_key,
                    context.prompt_versions,
                    context.budget,
                    capture_output,
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
            completed.append((item, trace, actual))
            session.add(
                EvalItemResultRecord(
                    eval_run_id=context.run.id,
                    dataset_item_id=item.id,
                    model_id=model_id,
                    trace_id=trace.id,
                    expected=redact_payload(item.expected, self.settings.trace_secrets()),
                    actual=trace.output or {},
                    scores=context.metric_suite.score_item(item.expected, actual),
                )
            )
            session.commit()
        self._store_model_results(session, context, model_id, completed)

    @staticmethod
    def _require_locked_runtime_inputs(
        graph_version: AgentSystemVersionRecord,
        item: DatasetItemRecord,
        agent_system_key: str,
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
        plugin = system_plugins().get(agent_system_key)
        exemptions = (
            plugin.legacy_locked_input_exemptions(definition, item.input)
            if plugin is not None
            else set()
        )
        missing = sorted(set(missing) - exemptions)
        if not missing:
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
        run.error = format_error_for_storage(error)
        run.completed_at = utc_now()
        session.add(run)
        session.commit()

    @staticmethod
    def _store_model_results(
        session: Session,
        context: EvaluationContext,
        model_id: str,
        completed: list[tuple[DatasetItemRecord, TraceRecord, dict[str, Any]]],
    ) -> None:
        expected_items: list[dict[str, Any]] = []
        actual_items: list[dict[str, Any]] = []
        latencies: list[float] = []
        costs: list[float] = []
        for item, trace, actual in completed:
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
