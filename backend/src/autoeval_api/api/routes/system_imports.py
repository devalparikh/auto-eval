from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, status

from autoeval_api.api.dependencies import SessionDependency
from autoeval_api.services.system_imports import (
    SystemImportConflictError,
    SystemImportFetchError,
    SystemImportService,
)
from autoeval_api.system_import_schemas import (
    EffectiveHandlersResponse,
    ImportSource,
    SystemImportCommitRequest,
    SystemImportInspectRequest,
    SystemImportPreview,
    SystemImportResult,
)

router = APIRouter()


def import_service(request: Request) -> SystemImportService:
    return request.app.state.system_import_service


@router.post("/api/system-imports/inspect", response_model=SystemImportPreview)
async def inspect_system_import(
    payload: SystemImportInspectRequest,
    request: Request,
    session: SessionDependency,
) -> SystemImportPreview:
    service = import_service(request)
    try:
        if payload.github_url is not None:
            return await service.inspect_github(session, payload.github_url)
        assert payload.manifest is not None
        return service.inspect_manifest(
            session,
            payload.manifest,
            payload.source or ImportSource(kind="local"),
        )
    except (SystemImportFetchError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post(
    "/api/system-imports/commit",
    response_model=SystemImportResult,
    status_code=status.HTTP_201_CREATED,
)
def commit_system_import(
    payload: SystemImportCommitRequest,
    request: Request,
    session: SessionDependency,
) -> SystemImportResult:
    try:
        return import_service(request).commit(session, payload)
    except SystemImportConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/api/system-imports/handlers", response_model=EffectiveHandlersResponse)
def effective_handlers(
    request: Request,
    system_key: Annotated[
        str | None,
        Query(pattern=r"^[a-z][a-z0-9-]{1,119}$"),
    ] = None,
) -> EffectiveHandlersResponse:
    handlers = import_service(request).node_registry.effective_handler_names(system_key)
    return EffectiveHandlersResponse(system_key=system_key, **handlers)
