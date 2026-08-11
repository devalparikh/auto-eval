from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from autoeval_api.api.dependencies import CodebaseServiceDependency
from autoeval_api.codebase.repository import RepositoryError
from autoeval_api.codebase.schemas import (
    CodebaseGraphResponse,
    CodebaseMode,
    CodebaseRevisionsResponse,
    CodebaseSource,
)

router = APIRouter()


@router.get("/api/codebase/revisions", response_model=CodebaseRevisionsResponse)
def codebase_revisions(service: CodebaseServiceDependency) -> CodebaseRevisionsResponse:
    try:
        return service.revisions()
    except RepositoryError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/api/codebase/graph", response_model=CodebaseGraphResponse)
def codebase_graph(
    service: CodebaseServiceDependency,
    source: CodebaseSource = "working",
    mode: CodebaseMode = "files",
    ref: Annotated[str | None, Query(max_length=240)] = None,
) -> CodebaseGraphResponse:
    try:
        return service.graph(source, ref, mode)
    except RepositoryError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
