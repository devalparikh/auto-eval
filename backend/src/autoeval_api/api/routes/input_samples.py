from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from autoeval_api.api.dependencies import SessionDependency, get_or_404
from autoeval_api.models import AgentSystemRecord, TraceRecord
from autoeval_api.schemas import CreateInputSampleRequest, InputSampleResponse
from autoeval_api.services.input_samples import create_input_sample, list_input_samples

router = APIRouter()


@router.get(
    "/api/agent-systems/{agent_system_id}/input-samples",
    response_model=list[InputSampleResponse],
)
def input_samples(
    agent_system_id: str,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> list[InputSampleResponse]:
    get_or_404(session, AgentSystemRecord, agent_system_id, "Agent system")
    return [
        InputSampleResponse.model_validate(record, from_attributes=True)
        for record in list_input_samples(session, agent_system_id, limit)
    ]


@router.post(
    "/api/agent-systems/{agent_system_id}/input-samples",
    response_model=InputSampleResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_input_sample(
    agent_system_id: str,
    payload: CreateInputSampleRequest,
    session: SessionDependency,
) -> InputSampleResponse:
    system = get_or_404(session, AgentSystemRecord, agent_system_id, "Agent system")
    trace = get_or_404(session, TraceRecord, payload.source_trace_id, "Source trace")
    try:
        record = create_input_sample(session, system, trace, payload.input)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return InputSampleResponse.model_validate(record, from_attributes=True)
