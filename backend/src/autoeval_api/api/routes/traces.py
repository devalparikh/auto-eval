from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from autoeval_api.api.dependencies import (
    ProviderRegistryDependency,
    RunnerDependency,
    SessionDependency,
    get_or_404,
    resolve_node_prompt_versions,
    resolve_run_versions,
)
from autoeval_api.graph.runner import RunSelection
from autoeval_api.models import TraceRecord
from autoeval_api.schemas import RunTraceRequest, TraceDatasetTargetsResponse, TraceResponse
from autoeval_api.services.traces import (
    list_trace_responses,
    trace_dataset_targets,
    trace_response,
)

router = APIRouter()


@router.get("/api/traces", response_model=list[TraceResponse])
def traces(
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    agent_system_id: str | None = None,
) -> list[TraceResponse]:
    return list_trace_responses(session, limit, agent_system_id)


@router.get("/api/traces/{trace_id}", response_model=TraceResponse)
def trace_detail(trace_id: str, session: SessionDependency) -> TraceResponse:
    trace = get_or_404(session, TraceRecord, trace_id, "Trace")
    return trace_response(session, trace)


@router.get(
    "/api/traces/{trace_id}/dataset-targets",
    response_model=TraceDatasetTargetsResponse,
)
def dataset_targets(trace_id: str, session: SessionDependency) -> TraceDatasetTargetsResponse:
    trace = get_or_404(session, TraceRecord, trace_id, "Trace")
    return trace_dataset_targets(session, trace)


@router.post("/api/traces/run", response_model=TraceResponse, status_code=status.HTTP_201_CREATED)
async def run_trace(
    payload: RunTraceRequest,
    session: SessionDependency,
    runner: RunnerDependency,
    provider_registry: ProviderRegistryDependency,
) -> TraceResponse:
    system, graph_version, prompt_version = resolve_run_versions(
        session,
        payload.agent_system_id,
        payload.agent_system_version_id,
        payload.prompt_version_id,
    )
    prompt_versions = resolve_node_prompt_versions(
        session,
        graph_version,
        payload.prompt_version_ids,
    )
    try:
        provider_registry.get_for_model(payload.model_id)
    except (ValueError, RuntimeError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    trace = await runner.run(
        session,
        RunSelection(
            graph_version,
            prompt_version,
            payload.model_id,
            system.key,
            prompt_versions,
        ),
        payload.input,
        runtime_input_snapshot_ids=payload.runtime_input_snapshot_ids,
    )
    return trace_response(session, trace)
