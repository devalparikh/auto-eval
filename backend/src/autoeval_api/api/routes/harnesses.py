from collections.abc import Callable
from threading import RLock
from typing import TypeVar

from fastapi import APIRouter, HTTPException

from autoeval_api.api.dependencies import SessionDependency
from autoeval_api.harness_schemas import (
    CaptureReview,
    ConnectHarness,
    HarnessCapture,
    HarnessReceipt,
    HarnessRun,
    HarnessSuite,
    HarnessTask,
    HarnessTrainingExport,
    HarnessWorkspace,
)
from autoeval_api.services import harnesses

router = APIRouter(prefix="/api/harnesses", tags=["harnesses"])
T = TypeVar("T")
# The supported local server is one process; serialize cross-record split checks and writes.
_admission = RLock()


def invoke(action: Callable[[], T]) -> T:
    try:
        with _admission:
            return action()
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@router.post("", response_model=HarnessWorkspace, status_code=201)
def connect(payload: ConnectHarness, session: SessionDependency):
    return invoke(lambda: harnesses.connect(session, payload))


@router.get("/{key}", response_model=HarnessWorkspace)
def workspace(key: str, session: SessionDependency):
    return invoke(lambda: harnesses.workspace(session, key))


@router.post("/{key}/tasks", response_model=HarnessReceipt, status_code=201)
def task(key: str, payload: HarnessTask, session: SessionDependency):
    return invoke(lambda: harnesses.add_task(session, key, payload))


@router.post("/{key}/captures", response_model=HarnessReceipt, status_code=201)
def capture(key: str, payload: HarnessCapture, session: SessionDependency):
    return invoke(lambda: harnesses.ingest(session, key, payload))


@router.get("/{key}/captures/{capture_id}", response_model=HarnessCapture)
def capture_detail(key: str, capture_id: str, session: SessionDependency):
    return invoke(lambda: harnesses.capture_for(session, key, capture_id).document)


@router.post("/{key}/captures/{capture_id}/review", response_model=HarnessReceipt)
def review(key: str, capture_id: str, payload: CaptureReview, session: SessionDependency):
    return invoke(lambda: harnesses.review(session, key, capture_id, payload.decision))


@router.post("/{key}/training-export", response_model=HarnessTrainingExport)
def training_export(key: str, session: SessionDependency):
    return invoke(lambda: harnesses.export_training(session, key))


@router.post("/{key}/suites", response_model=HarnessReceipt, status_code=201)
def suite(key: str, payload: HarnessSuite, session: SessionDependency):
    return invoke(lambda: harnesses.freeze_suite(session, key, payload))


@router.post("/{key}/runs", response_model=HarnessReceipt, status_code=201)
def run(key: str, payload: HarnessRun, session: SessionDependency):
    return invoke(lambda: harnesses.submit_run(session, key, payload))


@router.get("/{key}/runs/{run_id}", response_model=HarnessRun)
def run_detail(key: str, run_id: str, session: SessionDependency):
    return invoke(lambda: harnesses.run_detail(session, key, run_id))
