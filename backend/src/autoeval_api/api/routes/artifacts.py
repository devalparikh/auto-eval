from fastapi import APIRouter, HTTPException

from autoeval_api.api.dependencies import SessionDependency, get_or_404
from autoeval_api.models import AgentSystemRecord
from autoeval_api.schemas import ArtifactCatalogResponse, ArtifactDetail, ArtifactKind
from autoeval_api.services.artifacts import artifact_catalog, artifact_detail

router = APIRouter()


@router.get(
    "/api/agent-systems/{agent_system_id}/artifacts",
    response_model=ArtifactCatalogResponse,
)
def agent_system_artifacts(
    agent_system_id: str,
    session: SessionDependency,
) -> ArtifactCatalogResponse:
    owner = get_or_404(session, AgentSystemRecord, agent_system_id, "Agent system")
    return artifact_catalog(session, owner)


@router.get(
    "/api/artifacts/{artifact_kind}/{artifact_id}",
    response_model=ArtifactDetail,
)
def artifact(
    artifact_kind: ArtifactKind,
    artifact_id: str,
    session: SessionDependency,
) -> ArtifactDetail:
    try:
        return artifact_detail(session, artifact_kind, artifact_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
