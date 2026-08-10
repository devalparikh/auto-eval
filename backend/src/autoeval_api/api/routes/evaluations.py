from fastapi import APIRouter, BackgroundTasks, HTTPException, status

from autoeval_api.api.dependencies import (
    EvaluationServiceDependency,
    SessionDependency,
    get_or_404,
    resolve_run_versions,
)
from autoeval_api.models import DatasetRecord, DatasetVersionRecord, EvalRunRecord
from autoeval_api.schemas import CreateEvalRunRequest, EvalRunResponse
from autoeval_api.services.evaluations import eval_run_response, list_eval_runs

router = APIRouter()


@router.get("/api/eval-runs", response_model=list[EvalRunResponse])
def eval_runs(
    session: SessionDependency,
    dataset_version_id: str | None = None,
    agent_system_version_id: str | None = None,
    prompt_version_id: str | None = None,
) -> list[EvalRunResponse]:
    records = list_eval_runs(
        session,
        dataset_version_id=dataset_version_id,
        agent_system_version_id=agent_system_version_id,
        prompt_version_id=prompt_version_id,
    )
    return [eval_run_response(session, item, include_items=True) for item in records]


@router.get("/api/eval-runs/{run_id}", response_model=EvalRunResponse)
def eval_run_detail(run_id: str, session: SessionDependency) -> EvalRunResponse:
    run = get_or_404(session, EvalRunRecord, run_id, "Evaluation run")
    return eval_run_response(session, run, include_items=True)


@router.post("/api/eval-runs", response_model=EvalRunResponse, status_code=status.HTTP_201_CREATED)
async def create_eval_run(
    payload: CreateEvalRunRequest,
    background_tasks: BackgroundTasks,
    session: SessionDependency,
    evaluation_service: EvaluationServiceDependency,
) -> EvalRunResponse:
    dataset_version = get_or_404(
        session, DatasetVersionRecord, payload.dataset_version_id, "Dataset version"
    )
    dataset = get_or_404(session, DatasetRecord, dataset_version.dataset_id, "Dataset")
    _, graph_version, prompt_version = resolve_run_versions(
        session,
        dataset.agent_system_id,
        payload.agent_system_version_id,
        payload.prompt_version_id,
    )
    try:
        run = evaluation_service.create_run(
            session,
            dataset_version,
            graph_version,
            prompt_version,
            payload.model_ids,
        )
    except (ValueError, RuntimeError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if payload.run_in_background:
        background_tasks.add_task(evaluation_service.execute, run.id)
    else:
        await evaluation_service.execute(run.id)
        session.refresh(run)
    return eval_run_response(
        session,
        run,
        include_items=not payload.run_in_background,
    )
