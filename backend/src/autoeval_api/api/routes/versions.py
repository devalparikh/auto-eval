from fastapi import APIRouter, HTTPException, status

from autoeval_api.api.dependencies import SessionDependency, get_or_404
from autoeval_api.models import (
    AgentSystemRecord,
    AgentSystemVersionRecord,
    PromptRecord,
    PromptVersionRecord,
)
from autoeval_api.schemas import (
    AgentVersionDetail,
    CreateAgentVersionRequest,
    CreatePromptVersionRequest,
    PromptVersionDetail,
)
from autoeval_api.services.versioning import create_agent_version, create_prompt_version

router = APIRouter()


@router.post(
    "/api/agent-systems/{agent_system_id}/versions",
    response_model=AgentVersionDetail,
    status_code=status.HTTP_201_CREATED,
)
def add_agent_version(
    agent_system_id: str,
    payload: CreateAgentVersionRequest,
    session: SessionDependency,
) -> AgentVersionDetail:
    agent_system = get_or_404(session, AgentSystemRecord, agent_system_id, "Agent system")
    try:
        version = create_agent_version(session, agent_system, payload.definition)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return AgentVersionDetail.model_validate(version, from_attributes=True)


@router.get("/api/agent-system-versions/{version_id}", response_model=AgentVersionDetail)
def agent_version_detail(version_id: str, session: SessionDependency) -> AgentVersionDetail:
    version = get_or_404(session, AgentSystemVersionRecord, version_id, "Agent system version")
    return AgentVersionDetail.model_validate(version, from_attributes=True)


@router.post(
    "/api/prompts/{prompt_id}/versions",
    response_model=PromptVersionDetail,
    status_code=status.HTTP_201_CREATED,
)
def add_prompt_version(
    prompt_id: str,
    payload: CreatePromptVersionRequest,
    session: SessionDependency,
) -> PromptVersionDetail:
    prompt = get_or_404(session, PromptRecord, prompt_id, "Prompt")
    try:
        version = create_prompt_version(session, prompt, payload.content)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return PromptVersionDetail.model_validate(version, from_attributes=True)


@router.get("/api/prompt-versions/{version_id}", response_model=PromptVersionDetail)
def prompt_version_detail(version_id: str, session: SessionDependency) -> PromptVersionDetail:
    version = get_or_404(session, PromptVersionRecord, version_id, "Prompt version")
    return PromptVersionDetail.model_validate(version, from_attributes=True)
