from fastapi import APIRouter, HTTPException, Response, status

from autoeval_api.api.dependencies import SessionDependency, get_or_404
from autoeval_api.models import DatasetItemRecord, DatasetRecord, TraceRecord
from autoeval_api.schemas import (
    AddTraceToDatasetRequest,
    CreateDatasetVersionRequest,
    DatasetItemInput,
    DatasetItemResponse,
    DatasetVersionDetail,
    UpdateDatasetItemRequest,
)
from autoeval_api.services.datasets import (
    add_dataset_item,
    add_trace_to_dataset,
    create_dataset_version,
    dataset_version_detail,
    finalize_dataset_version,
    get_dataset_version,
    update_dataset_item,
)

router = APIRouter()


@router.post(
    "/api/datasets/{dataset_id}/versions",
    response_model=DatasetVersionDetail,
    status_code=status.HTTP_201_CREATED,
)
def add_dataset_version(
    dataset_id: str,
    payload: CreateDatasetVersionRequest,
    session: SessionDependency,
) -> DatasetVersionDetail:
    dataset = get_or_404(session, DatasetRecord, dataset_id, "Dataset")
    try:
        version = create_dataset_version(session, dataset, payload.clone_from_version_id)
    except (LookupError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return dataset_version_detail(session, version)


@router.get("/api/dataset-versions/{version_id}", response_model=DatasetVersionDetail)
def get_version_detail(version_id: str, session: SessionDependency) -> DatasetVersionDetail:
    try:
        version = get_dataset_version(session, version_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return dataset_version_detail(session, version)


@router.post(
    "/api/dataset-versions/{version_id}/items",
    response_model=DatasetItemResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_item(
    version_id: str,
    payload: DatasetItemInput,
    session: SessionDependency,
) -> DatasetItemResponse:
    return _add_item(session, version_id, payload)


@router.put(
    "/api/dataset-versions/{version_id}/trace-items/{trace_id}",
    response_model=DatasetItemResponse,
)
def add_item_from_trace(
    version_id: str,
    trace_id: str,
    payload: AddTraceToDatasetRequest,
    session: SessionDependency,
    response: Response,
) -> DatasetItemResponse:
    try:
        version = get_dataset_version(session, version_id)
        trace = get_or_404(session, TraceRecord, trace_id, "Trace")
        item, created = add_trace_to_dataset(session, version, trace, payload.expected)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return DatasetItemResponse.model_validate(item, from_attributes=True)


def _add_item(
    session: SessionDependency,
    version_id: str,
    payload: DatasetItemInput,
) -> DatasetItemResponse:
    try:
        version = get_dataset_version(session, version_id)
        item = add_dataset_item(
            session,
            version,
            payload.input,
            payload.expected,
            payload.runtime_input_snapshot_ids,
        )
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return DatasetItemResponse.model_validate(item, from_attributes=True)


@router.put("/api/dataset-items/{item_id}", response_model=DatasetItemResponse)
def update_item(
    item_id: str,
    payload: UpdateDatasetItemRequest,
    session: SessionDependency,
) -> DatasetItemResponse:
    item = get_or_404(session, DatasetItemRecord, item_id, "Dataset item")
    try:
        item = update_dataset_item(
            session,
            item,
            payload.input,
            payload.expected,
            payload.runtime_input_snapshot_ids,
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return DatasetItemResponse.model_validate(item, from_attributes=True)


@router.post("/api/dataset-versions/{version_id}/finalize", response_model=DatasetVersionDetail)
def finalize_version(version_id: str, session: SessionDependency) -> DatasetVersionDetail:
    try:
        version = finalize_dataset_version(session, get_dataset_version(session, version_id))
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return dataset_version_detail(session, version)
