from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from autoeval_api.api.dependencies import SessionDependency, get_or_404
from autoeval_api.models import AgentSystemRecord, RuntimeInputSnapshotRecord
from autoeval_api.schemas import RuntimeInputSnapshotDetail, RuntimeInputSnapshotSummary
from autoeval_api.services.runtime_input_snapshots import (
    list_runtime_input_snapshots,
    runtime_input_snapshot_detail,
    runtime_input_snapshot_summary,
)

router = APIRouter()


@router.get(
    "/api/agent-systems/{agent_system_id}/runtime-input-snapshots",
    response_model=list[RuntimeInputSnapshotSummary],
)
def runtime_input_snapshots(
    agent_system_id: str,
    session: SessionDependency,
    source_key: str | None = None,
    node_id: str | None = None,
    synthetic_only: bool = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> list[RuntimeInputSnapshotSummary]:
    get_or_404(session, AgentSystemRecord, agent_system_id, "Agent system")
    records = list_runtime_input_snapshots(
        session,
        agent_system_id,
        source_key=source_key,
        node_id=node_id,
        synthetic_only=synthetic_only,
        limit=limit,
    )
    return [runtime_input_snapshot_summary(record) for record in records]


@router.get(
    "/api/runtime-input-snapshots/{snapshot_id}",
    response_model=RuntimeInputSnapshotDetail,
)
def runtime_input_snapshot(
    snapshot_id: str,
    session: SessionDependency,
) -> RuntimeInputSnapshotDetail:
    record = get_or_404(
        session,
        RuntimeInputSnapshotRecord,
        snapshot_id,
        "Runtime-input snapshot",
    )
    try:
        return runtime_input_snapshot_detail(record)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
