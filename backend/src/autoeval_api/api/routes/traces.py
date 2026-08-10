from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from autoeval_api.api.dependencies import (
    ProviderRegistryDependency,
    RunnerDependency,
    SessionDependency,
    get_or_404,
    resolve_graph_version,
    resolve_prompt_version,
)
from autoeval_api.graph.runner import RunSelection
from autoeval_api.models import TraceRecord
from autoeval_api.schemas import RunTraceRequest, TraceResponse
from autoeval_api.services.traces import list_traces, trace_response

router = APIRouter()


@router.get("/api/traces", response_model=list[TraceResponse])
def traces(
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[TraceResponse]:
    return [
        trace_response(session, item, include_graph=False) for item in list_traces(session, limit)
    ]


@router.get("/api/traces/{trace_id}", response_model=TraceResponse)
def trace_detail(trace_id: str, session: SessionDependency) -> TraceResponse:
    trace = get_or_404(session, TraceRecord, trace_id, "Trace")
    return trace_response(session, trace)


@router.post("/api/traces/run", response_model=TraceResponse, status_code=status.HTTP_201_CREATED)
async def run_trace(
    payload: RunTraceRequest,
    session: SessionDependency,
    runner: RunnerDependency,
    provider_registry: ProviderRegistryDependency,
) -> TraceResponse:
    graph_version = resolve_graph_version(session, payload.agent_system_version_id)
    prompt_version = resolve_prompt_version(session, payload.prompt_version_id)
    try:
        provider_registry.get_for_model(payload.model_id)
    except (ValueError, RuntimeError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    trace = await runner.run(
        session,
        RunSelection(graph_version, prompt_version, payload.model_id),
        payload.input,
    )
    return trace_response(session, trace)
