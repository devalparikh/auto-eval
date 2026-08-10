from collections.abc import Generator
from typing import Annotated, TypeVar

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from autoeval_api.graph.runner import AgentGraphRunner
from autoeval_api.inference.registry import InferenceProviderRegistry
from autoeval_api.models import (
    AgentSystemRecord,
    AgentSystemVersionRecord,
    PromptRecord,
    PromptVersionRecord,
)
from autoeval_api.services.evaluations import EvaluationService
from autoeval_api.services.versioning import (
    default_agent_system,
    latest_agent_version,
    latest_prompt_version,
    resolve_graph_prompt_versions,
)

Record = TypeVar("Record")


def session_dependency(request: Request) -> Generator[Session, None, None]:
    session = request.app.state.session_factory()
    try:
        yield session
    finally:
        session.close()


def runner_dependency(request: Request) -> AgentGraphRunner:
    return request.app.state.runner


def provider_registry_dependency(request: Request) -> InferenceProviderRegistry:
    return request.app.state.provider_registry


def evaluation_service_dependency(request: Request) -> EvaluationService:
    return request.app.state.evaluation_service


SessionDependency = Annotated[Session, Depends(session_dependency)]
RunnerDependency = Annotated[AgentGraphRunner, Depends(runner_dependency)]
ProviderRegistryDependency = Annotated[
    InferenceProviderRegistry, Depends(provider_registry_dependency)
]
EvaluationServiceDependency = Annotated[EvaluationService, Depends(evaluation_service_dependency)]


def get_or_404(session: Session, model: type[Record], record_id: str, label: str) -> Record:
    record = session.get(model, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"{label} not found")
    return record


def resolve_agent_system(session: Session, agent_system_id: str | None) -> AgentSystemRecord:
    if agent_system_id:
        return get_or_404(session, AgentSystemRecord, agent_system_id, "Agent system")
    try:
        return default_agent_system(session)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


def resolve_graph_version(
    session: Session,
    version_id: str | None,
    agent_system_id: str | None = None,
) -> AgentSystemVersionRecord:
    if version_id:
        version = get_or_404(session, AgentSystemVersionRecord, version_id, "Agent system version")
        if agent_system_id and version.agent_system_id != agent_system_id:
            raise HTTPException(
                status_code=400,
                detail="Agent system version belongs to another agent system",
            )
        return version
    try:
        return latest_agent_version(session, agent_system_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


def resolve_prompt_version(
    session: Session,
    version_id: str | None,
    agent_system_id: str | None = None,
) -> PromptVersionRecord:
    system_id = agent_system_id or resolve_agent_system(session, None).id
    if version_id:
        version = get_or_404(session, PromptVersionRecord, version_id, "Prompt version")
        prompt = session.get(PromptRecord, version.prompt_id)
        if prompt is None or prompt.agent_system_id != system_id:
            raise HTTPException(
                status_code=400,
                detail="Prompt version belongs to another agent system",
            )
        return version
    try:
        return latest_prompt_version(session, system_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


def resolve_run_versions(
    session: Session,
    agent_system_id: str | None,
    graph_version_id: str | None,
    prompt_version_id: str | None,
) -> tuple[AgentSystemRecord, AgentSystemVersionRecord, PromptVersionRecord]:
    if graph_version_id:
        graph_version = resolve_graph_version(session, graph_version_id, agent_system_id)
        system = resolve_agent_system(session, graph_version.agent_system_id)
    else:
        system = resolve_agent_system(session, agent_system_id)
        graph_version = resolve_graph_version(session, None, system.id)
    prompt_version = resolve_prompt_version(session, prompt_version_id, system.id)
    return system, graph_version, prompt_version


def resolve_node_prompt_versions(
    session: Session,
    graph_version: AgentSystemVersionRecord,
    requested_version_ids: dict[str, str] | None,
) -> dict[str, PromptVersionRecord]:
    try:
        return resolve_graph_prompt_versions(session, graph_version, requested_version_ids)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
