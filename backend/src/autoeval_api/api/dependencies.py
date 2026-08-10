from collections.abc import Generator
from typing import Annotated, TypeVar

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from autoeval_api.graph.runner import AgentGraphRunner
from autoeval_api.inference.registry import InferenceProviderRegistry
from autoeval_api.models import AgentSystemVersionRecord, PromptVersionRecord
from autoeval_api.services.evaluations import EvaluationService
from autoeval_api.services.versioning import latest_agent_version, latest_prompt_version

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


def resolve_graph_version(session: Session, version_id: str | None) -> AgentSystemVersionRecord:
    if version_id:
        return get_or_404(session, AgentSystemVersionRecord, version_id, "Agent system version")
    try:
        return latest_agent_version(session)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


def resolve_prompt_version(session: Session, version_id: str | None) -> PromptVersionRecord:
    if version_id:
        return get_or_404(session, PromptVersionRecord, version_id, "Prompt version")
    try:
        return latest_prompt_version(session)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
