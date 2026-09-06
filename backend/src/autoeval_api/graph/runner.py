from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field, replace
from inspect import isawaitable
from time import perf_counter
from typing import Any

from langgraph.graph import END, StateGraph
from langgraph.runtime import Runtime
from sqlalchemy.orm import Session

from autoeval_api.graph.context import GraphRuntimeContext, NodeResourceExecutionBinding
from autoeval_api.graph.definition import (
    AgentGraphDefinition,
    AgentNodeDefinition,
    NodeResourceSelection,
    parse_graph_definition,
)
from autoeval_api.graph.registry import NodeHandlerRegistry, default_node_handler_registry
from autoeval_api.graph.runtime_inputs import RuntimeInputCapabilityRegistry
from autoeval_api.graph.topology import sink_node_ids, topological_sequence
from autoeval_api.graph.trace_policy import project_inference_payload, project_trace_payload
from autoeval_api.graph.trace_recorder import TraceRecorder
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
    format_error_for_storage,
    utc_now,
)
from autoeval_api.services.node_resources import resolve_node_resource
from autoeval_api.services.runtime_input_snapshots import (
    resolve_runtime_input_snapshot,
    runtime_input_snapshot_binding,
)
from autoeval_api.services.versioning import resolve_graph_prompt_versions


@dataclass(frozen=True)
class RunSelection:
    graph_version: AgentSystemVersionRecord
    prompt_version: PromptVersionRecord
    model_id: str
    agent_system_key: str
    prompt_versions: dict[str, PromptVersionRecord] = field(default_factory=dict)


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
        runtime_input_registry: RuntimeInputCapabilityRegistry | None = None,
    ) -> None:
        self.provider_registry = provider_registry
        self.node_registry = node_registry or default_node_handler_registry()
        self.runtime_input_registry = runtime_input_registry or RuntimeInputCapabilityRegistry()

    async def run(
        self,
        session: Session,
        selection: RunSelection,
        request_input: dict[str, Any],
        trace_context: TraceContext | None = None,
        runtime_input_snapshot_ids: dict[str, str] | None = None,
        node_resource_selections: dict[str, NodeResourceSelection | dict[str, Any]] | None = None,
        capture_node_outputs: bool = False,
    ) -> TraceRecord:
        selection = replace(
            selection,
            prompt_versions=resolve_graph_prompt_versions(
                session,
                selection.graph_version,
                {key: version.id for key, version in selection.prompt_versions.items()},
            ),
        )
        definition = parse_graph_definition(selection.graph_version.definition)
        self.node_registry.validate_definition(definition, selection.agent_system_key)
        self.runtime_input_registry.validate_definition(definition)
        trace_origin_context = trace_context or TraceContext()
        trace = TraceRecord(
            status=RunStatus.RUNNING,
            agent_system_version_id=selection.graph_version.id,
            prompt_version_id=selection.prompt_version.id,
            prompt_version_ids={
                key: version.id for key, version in selection.prompt_versions.items()
            },
            origin_type=trace_origin_context.origin_type,
            evaluation_run_id=trace_origin_context.evaluation_run_id,
            evaluation_dataset_item_id=trace_origin_context.evaluation_dataset_item_id,
            model_id=selection.model_id,
            request_input=project_trace_payload(selection.agent_system_key, request_input),
            runtime_input_snapshot_ids={},
            node_snapshot_ids={},
            node_resource_selections={},
            capture_node_outputs=capture_node_outputs,
        )
        recorder = TraceRecorder(session)
        recorder.start_trace(trace)

        started = perf_counter()
        runtime_context: GraphRuntimeContext | None = None
        try:
            runtime_input_modes = definition.runtime_input_modes(
                evaluation=trace_origin_context.origin_type == TraceOrigin.EVALUATION,
            )
            runtime_context = GraphRuntimeContext(
                session,
                selection.agent_system_key,
                trace_id=trace.id,
                runtime_inputs=self.runtime_input_registry,
                runtime_input_modes=runtime_input_modes,
                capture_node_outputs=capture_node_outputs,
            )
            self._bind_locked_runtime_input_snapshots(
                runtime_context,
                runtime_input_snapshot_ids or {},
            )
            self._bind_node_resource_selections(
                runtime_context,
                definition,
                node_resource_selections or {},
                trace_origin_context.origin_type,
            )
            graph = self._compile_graph(recorder, trace, selection, definition)
            state = await graph.ainvoke(
                {"input": request_input, "data": {}},
                context=runtime_context,
            )
            raw_output = state.get("output", state)
            trace.output = project_trace_payload(selection.agent_system_key, raw_output)
            trace.status = RunStatus.COMPLETE
        except Exception as error:
            trace.status = RunStatus.FAILED
            trace.error = format_error_for_storage(error)
        finally:
            trace.latency_ms = round((perf_counter() - started) * 1000, 3)
            trace.completed_at = utc_now()
            recorder.finish_trace(trace, runtime_context)
        return trace

    def _compile_graph(
        self,
        recorder: TraceRecorder,
        trace: TraceRecord,
        selection: RunSelection,
        definition: AgentGraphDefinition,
    ):
        sequence = topological_sequence(definition)
        builder = StateGraph(AgentState, context_schema=GraphRuntimeContext)

        for node in definition.nodes:
            builder.add_node(
                node.id,
                self._traced_node(recorder, trace, selection, node, sequence[node.id]),
            )

        builder.set_entry_point(definition.entry_point)
        for edge in definition.edges:
            builder.add_edge(edge.source, edge.target)
        for node_id in sink_node_ids(definition):
            builder.add_edge(node_id, END)
        return builder.compile()

    def _traced_node(
        self,
        recorder: TraceRecorder,
        trace: TraceRecord,
        selection: RunSelection,
        node: AgentNodeDefinition,
        sequence: int,
    ) -> Callable[[AgentState], Awaitable[dict[str, Any]]]:
        async def invoke(
            state: AgentState,
            runtime: Runtime[GraphRuntimeContext],
        ) -> dict[str, Any]:
            snapshot = self._domain_state(state)
            prompt_version = (
                self._node_prompt_version(selection, node) if node.kind == "llm" else None
            )
            system_prompt = prompt_version.content if prompt_version is not None else None
            span = TraceSpanRecord(
                trace_id=trace.id,
                node_id=node.id,
                node_kind=node.kind,
                prompt_version_id=prompt_version.id if prompt_version is not None else None,
                sequence=sequence,
                status=RunStatus.RUNNING,
                system_prompt=system_prompt,
                input=project_trace_payload(selection.agent_system_key, snapshot),
            )
            self._sync_span_snapshot_fields(span, runtime.context, node.id)
            recorder.start_span(span)
            started = perf_counter()

            try:
                if node.kind == "deterministic":
                    output = self.node_registry.deterministic(
                        node.handler, selection.agent_system_key
                    )(snapshot, runtime.context)
                    if isawaitable(output):
                        output = await output
                    self._validate_node_snapshot_policy(runtime.context, node)
                    inference = None
                else:
                    inference = await self._run_inference(
                        selection,
                        node,
                        snapshot,
                        prompt_version,
                    )
                    output = self.node_registry.llm_output(
                        node.handler, selection.agent_system_key
                    )(snapshot, inference)
                span.output = self._span_output(selection.agent_system_key, output, inference)
                span.status = RunStatus.COMPLETE
                self._apply_usage(span, inference)
                return self._graph_update(output)
            except Exception as error:
                span.status = RunStatus.FAILED
                span.error = format_error_for_storage(error)
                raise
            finally:
                self._sync_span_snapshot_fields(span, runtime.context, node.id)
                span.latency_ms = round((perf_counter() - started) * 1000, 3)
                span.completed_at = utc_now()
                recorder.finish_span(span)

        return invoke

    @staticmethod
    def _sync_span_snapshot_fields(
        span: TraceSpanRecord,
        context: GraphRuntimeContext,
        node_id: str,
    ) -> None:
        span.runtime_input_snapshot_id = context.runtime_input_snapshot_ids.get(node_id)
        node_snapshot = context.node_snapshots.get(node_id)
        span.node_snapshot_id = node_snapshot.id if node_snapshot is not None else None
        span.snapshot_role = node_snapshot.role if node_snapshot is not None else None
        span.snapshot_resolution_mode = (
            node_snapshot.resolution_mode if node_snapshot is not None else None
        )
        span.snapshot_metadata = dict(node_snapshot.metadata) if node_snapshot is not None else {}

    @staticmethod
    def _bind_locked_runtime_input_snapshots(
        context: GraphRuntimeContext,
        selected_ids: dict[str, str],
    ) -> None:
        unknown_nodes = sorted(set(selected_ids) - set(context.runtime_input_modes))
        if unknown_nodes:
            raise ValueError(
                "Runtime-input snapshots selected for nodes without a policy: "
                + ", ".join(unknown_nodes)
            )
        for node_id, snapshot_id in selected_ids.items():
            configured = context.runtime_input_modes[node_id]
            if configured.mode != "locked":
                raise ValueError(f"Runtime-input snapshot cannot bind refresh-mode node: {node_id}")
            record, _payload = resolve_runtime_input_snapshot(
                context.session,
                snapshot_id,
                owner_system_key=context.agent_system_key,
                source_key=configured.source,
                node_id=node_id,
                schema_version=configured.schema_version,
            )
            context.bind_runtime_input_snapshot(
                node_id,
                runtime_input_snapshot_binding(record),
            )

    @staticmethod
    def _bind_node_resource_selections(
        context: GraphRuntimeContext,
        definition: AgentGraphDefinition,
        selected_values: dict[str, NodeResourceSelection | dict[str, Any]],
        origin_type: str,
    ) -> None:
        policies = definition.resource_policies()
        unknown_nodes = sorted(set(selected_values) - set(policies))
        if unknown_nodes:
            raise ValueError(
                "Node resources selected for nodes without a policy: " + ", ".join(unknown_nodes)
            )
        missing = sorted(
            node_id
            for node_id, policy in policies.items()
            if policy.required and node_id not in selected_values
        )
        if missing:
            raise ValueError("Required node resource selections are missing: " + ", ".join(missing))
        for node_id, selected_value in selected_values.items():
            selection = NodeResourceSelection.model_validate(selected_value)
            policy = policies[node_id]
            if origin_type == TraceOrigin.EVALUATION and selection.mode != "locked":
                raise ValueError(
                    f"Evaluation node resource must be locked to an exact snapshot: {node_id}"
                )
            resolved = resolve_node_resource(
                context.session,
                consumer_system_key=context.agent_system_key,
                policy=policy,
                selection=selection,
            )
            context.bind_node_resource(
                node_id,
                NodeResourceExecutionBinding(
                    snapshot_id=resolved.snapshot_id,
                    resource_identity=resolved.resource_identity,
                    content=resolved.content,
                    metadata=resolved.metadata,
                ),
                selection_mode=selection.mode,
            )

    @staticmethod
    def _validate_node_snapshot_policy(
        context: GraphRuntimeContext,
        node: AgentNodeDefinition,
    ) -> None:
        policy = node.snapshot_policy
        if policy is None:
            return
        binding = context.node_snapshots.get(node.id)
        if binding is None or binding.id is None:
            if policy.required:
                raise RuntimeError(
                    f"Snapshot-enabled node did not bind an output snapshot: {node.id}"
                )
            return
        if policy.binding_mode == "produce" and binding.role != "produced":
            raise RuntimeError(f"Snapshot node must produce its binding: {node.id}")
        if policy.binding_mode == "consume" and binding.role != "consumed":
            raise RuntimeError(f"Snapshot node must consume its binding: {node.id}")
        if binding.metadata.get("output_key") != policy.output_key:
            raise RuntimeError(f"Snapshot output key does not match graph policy: {node.id}")
        if binding.metadata.get("schema_version") != policy.schema_version:
            raise RuntimeError(f"Snapshot schema version does not match graph policy: {node.id}")

    async def _run_inference(
        self,
        selection: RunSelection,
        node: AgentNodeDefinition,
        state: dict[str, Any],
        prompt_version: PromptVersionRecord,
    ) -> InferenceResponse:
        provider = self.provider_registry.get_for_model(selection.model_id)
        normalized = state.get("normalized", {})
        modalities = normalized.get("modalities", [])
        return await provider.complete(
            InferenceRequest(
                model_id=selection.model_id,
                system_prompt=prompt_version.content,
                task=node.task or node.handler,
                state=project_inference_payload(selection.agent_system_key, state),
                response_schema=node.response_schema,
                agent_system_key=selection.agent_system_key,
                modalities=modalities if isinstance(modalities, list) else [],
            )
        )

    @staticmethod
    def _node_prompt_version(
        selection: RunSelection,
        node: AgentNodeDefinition,
    ) -> PromptVersionRecord:
        prompt_key = node.prompt_key
        if not prompt_key:
            return selection.prompt_version
        prompt_version = selection.prompt_versions.get(prompt_key)
        if prompt_version is None:
            raise RuntimeError(f"No prompt version resolved for graph prompt key: {prompt_key}")
        return prompt_version

    @staticmethod
    def _domain_state(state: AgentState) -> dict[str, Any]:
        domain = {"input": state.get("input", {}), **state.get("data", {})}
        if state.get("output") is not None:
            domain["output"] = state["output"]
        return domain

    @staticmethod
    def _graph_update(output: dict[str, Any]) -> dict[str, Any]:
        update: dict[str, Any] = {}
        data = {key: value for key, value in output.items() if key != "output"}
        if data:
            update["data"] = data
        if "output" in output:
            update["output"] = output["output"]
        return update

    @staticmethod
    def _apply_usage(span: TraceSpanRecord, response: InferenceResponse | None) -> None:
        if response is None:
            return
        span.input_tokens = response.input_tokens
        span.output_tokens = response.output_tokens
        span.cost_usd = response.cost_usd

    @staticmethod
    def _span_output(
        system_key: str,
        output: dict[str, Any],
        response: InferenceResponse | None,
    ) -> dict[str, Any]:
        projected = project_trace_payload(system_key, output)
        if response is None:
            return projected
        metadata = {
            key: response.metadata[key]
            for key in ("request_id", "resolved_model", "deterministic")
            if response.metadata.get(key) is not None
        }
        return {**projected, "_inference": metadata} if metadata else projected
