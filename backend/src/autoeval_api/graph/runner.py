from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from time import perf_counter
from typing import Any

from langgraph.graph import END, StateGraph
from sqlalchemy.orm import Session

from autoeval_api.graph.registry import NodeHandlerRegistry, default_node_handler_registry
from autoeval_api.graph.topology import sink_node_ids, topological_sequence
from autoeval_api.graph.trace_policy import project_trace_payload
from autoeval_api.graph.types import AgentState
from autoeval_api.inference.base import InferenceRequest, InferenceResponse
from autoeval_api.inference.registry import InferenceProviderRegistry
from autoeval_api.models import (
    AgentSystemVersionRecord,
    PromptVersionRecord,
    RunStatus,
    TraceOrigin,
    TraceRecord,
    TraceSpanRecord,
    utc_now,
)


@dataclass(frozen=True)
class RunSelection:
    graph_version: AgentSystemVersionRecord
    prompt_version: PromptVersionRecord
    model_id: str
    agent_system_key: str = "incident-triage"


@dataclass(frozen=True)
class TraceContext:
    origin_type: str = TraceOrigin.RUNTIME
    evaluation_run_id: str | None = None
    evaluation_dataset_item_id: str | None = None


class AgentGraphRunner:
    def __init__(
        self,
        provider_registry: InferenceProviderRegistry,
        node_registry: NodeHandlerRegistry | None = None,
    ) -> None:
        self.provider_registry = provider_registry
        self.node_registry = node_registry or default_node_handler_registry()

    async def run(
        self,
        session: Session,
        selection: RunSelection,
        request_input: dict[str, Any],
        trace_context: TraceContext | None = None,
    ) -> TraceRecord:
        definition = selection.graph_version.definition
        self.node_registry.validate_definition(definition)
        context = trace_context or TraceContext()
        trace = TraceRecord(
            status=RunStatus.RUNNING,
            agent_system_version_id=selection.graph_version.id,
            prompt_version_id=selection.prompt_version.id,
            origin_type=context.origin_type,
            evaluation_run_id=context.evaluation_run_id,
            evaluation_dataset_item_id=context.evaluation_dataset_item_id,
            model_id=selection.model_id,
            request_input=project_trace_payload(selection.agent_system_key, request_input),
        )
        session.add(trace)
        session.commit()

        started = perf_counter()
        try:
            graph = self._compile_graph(session, trace, selection)
            state = await graph.ainvoke({"input": request_input})
            trace.output = state.get("output", state)
            trace.status = RunStatus.COMPLETE
        except Exception as error:
            trace.status = RunStatus.FAILED
            trace.error = self._safe_error(error)
        finally:
            trace.latency_ms = round((perf_counter() - started) * 1000, 3)
            trace.completed_at = utc_now()
            spans = session.query(TraceSpanRecord).filter_by(trace_id=trace.id).all()
            trace.cost_usd = round(sum(span.cost_usd for span in spans), 8)
            trace.input_tokens = sum(span.input_tokens for span in spans)
            trace.output_tokens = sum(span.output_tokens for span in spans)
            session.add(trace)
            session.commit()
            session.refresh(trace)
        return trace

    def _compile_graph(self, session: Session, trace: TraceRecord, selection: RunSelection):
        definition = selection.graph_version.definition
        sequence = topological_sequence(definition)
        builder = StateGraph(AgentState)

        for node in definition["nodes"]:
            node_sequence = sequence[node["id"]]
            builder.add_node(
                node["id"],
                self._traced_node(session, trace, selection, node, node_sequence),
            )

        builder.set_entry_point(definition["entry_point"])
        for edge in definition["edges"]:
            builder.add_edge(edge["source"], edge["target"])
        for node_id in sink_node_ids(definition):
            builder.add_edge(node_id, END)
        return builder.compile()

    def _traced_node(
        self,
        session: Session,
        trace: TraceRecord,
        selection: RunSelection,
        node: dict[str, Any],
        sequence: int,
    ) -> Callable[[AgentState], Awaitable[dict[str, Any]]]:
        async def invoke(state: AgentState) -> dict[str, Any]:
            snapshot = dict(state)
            system_prompt = selection.prompt_version.content if node["kind"] == "llm" else None
            span = TraceSpanRecord(
                trace_id=trace.id,
                node_id=node["id"],
                node_kind=node["kind"],
                sequence=sequence,
                status=RunStatus.RUNNING,
                system_prompt=system_prompt,
                input=project_trace_payload(selection.agent_system_key, snapshot),
            )
            session.add(span)
            session.commit()
            started = perf_counter()

            try:
                if node["kind"] == "deterministic":
                    output = self.node_registry.deterministic(node["handler"])(snapshot)
                    inference = None
                else:
                    inference = await self._run_inference(selection, node, snapshot)
                    output = self.node_registry.llm_output(node["handler"])(snapshot, inference)
                span.output = project_trace_payload(selection.agent_system_key, output)
                span.status = RunStatus.COMPLETE
                self._apply_usage(span, inference)
                return output
            except Exception as error:
                span.status = RunStatus.FAILED
                span.error = self._safe_error(error)
                raise
            finally:
                span.latency_ms = round((perf_counter() - started) * 1000, 3)
                span.completed_at = utc_now()
                session.add(span)
                session.commit()

        return invoke

    async def _run_inference(
        self,
        selection: RunSelection,
        node: dict[str, Any],
        state: dict[str, Any],
    ) -> InferenceResponse:
        provider = self.provider_registry.get_for_model(selection.model_id)
        normalized = state.get("normalized", {})
        modalities = normalized.get("modalities", [])
        return await provider.complete(
            InferenceRequest(
                model_id=selection.model_id,
                system_prompt=selection.prompt_version.content,
                task=node.get("task") or node["handler"],
                state=state,
                modalities=modalities if isinstance(modalities, list) else [],
            )
        )

    @staticmethod
    def _apply_usage(span: TraceSpanRecord, response: InferenceResponse | None) -> None:
        if response is None:
            return
        span.input_tokens = response.input_tokens
        span.output_tokens = response.output_tokens
        span.cost_usd = response.cost_usd

    @staticmethod
    def _safe_error(error: Exception) -> str:
        message = str(error).strip() or error.__class__.__name__
        return message[:2000]
