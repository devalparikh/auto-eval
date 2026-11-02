import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse

from autoeval_api.api.dependencies import SessionDependency
from autoeval_api.schemas import (
    CreateCustomModelRequest,
    CustomModelResponse,
    TrainingDataPreview,
    TrainingRuntime,
    UpdateCustomModelRequest,
)
from autoeval_api.services.custom_models import CustomModelService, TrainingConflict
from autoeval_api.training.data import prepare_training_data


def service_dependency(request: Request) -> CustomModelService:
    return request.app.state.custom_model_service


Service = Annotated[CustomModelService, Depends(service_dependency)]
router = APIRouter(prefix="/api/custom-models", tags=["custom-models"])


def domain_error(error: Exception) -> HTTPException:
    status = (
        404
        if isinstance(error, LookupError)
        else 409
        if isinstance(error, TrainingConflict)
        else 400
    )
    return HTTPException(status_code=status, detail=str(error))


@router.get("/runtime", response_model=TrainingRuntime)
async def runtime(service: Service):
    return await asyncio.to_thread(service.trainer.runtime, production=service.settings.production)


@router.post("/preview", response_model=TrainingDataPreview)
def preview(request: CreateCustomModelRequest, session: SessionDependency):
    try:
        return prepare_training_data(
            session, request.dataset_version_id, request.system_prompt
        ).preview()
    except (LookupError, ValueError) as error:
        raise domain_error(error) from error


@router.get("", response_model=list[CustomModelResponse])
def list_models(session: SessionDependency, service: Service):
    return service.list_models(session)


@router.post("", response_model=CustomModelResponse, status_code=201)
def create_model(request: CreateCustomModelRequest, session: SessionDependency, service: Service):
    try:
        return service.create(session, request)
    except (LookupError, ValueError) as error:
        raise domain_error(error) from error


@router.get("/{model_id}", response_model=CustomModelResponse)
def get_model(model_id: str, session: SessionDependency, service: Service):
    try:
        return service.get(session, model_id)
    except LookupError as error:
        raise domain_error(error) from error


@router.put("/{model_id}", response_model=CustomModelResponse)
def update_model(
    model_id: str, request: UpdateCustomModelRequest, session: SessionDependency, service: Service
):
    try:
        return service.update_metadata(session, model_id, request)
    except (LookupError, ValueError) as error:
        raise domain_error(error) from error


@router.post("/{model_id}/train", response_model=CustomModelResponse, status_code=202)
async def train_model(model_id: str, service: Service):
    try:
        return await service.start(model_id)
    except (LookupError, ValueError) as error:
        raise domain_error(error) from error


@router.post("/{model_id}/cancel", response_model=CustomModelResponse)
async def cancel_model(model_id: str, service: Service):
    try:
        return await service.cancel(model_id)
    except (LookupError, ValueError) as error:
        raise domain_error(error) from error


@router.get("/{model_id}/artifacts", response_class=FileResponse)
def artifacts(model_id: str, session: SessionDependency, service: Service):
    try:
        path = service.artifact_archive(session, model_id)
        return FileResponse(
            path, media_type="application/zip", filename=f"custom-model-{model_id}.zip"
        )
    except (LookupError, ValueError) as error:
        raise domain_error(error) from error
