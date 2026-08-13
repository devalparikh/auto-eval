from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from autoeval_api.api.dependencies import SessionDependency
from autoeval_api.schemas import NodeSnapshotDetail, NodeSnapshotSummary
from autoeval_api.services.node_snapshots import (
    list_node_snapshots,
    node_snapshot_detail,
)

router = APIRouter()


@router.get("/api/node-snapshots", response_model=list[NodeSnapshotSummary])
def node_snapshots(
    session: SessionDependency,
    agent_system_id: str | None = None,
    agent_system_key: str | None = None,
    product_key: str | None = None,
    node_id: str | None = None,
    output_key: str | None = None,
    schema_version: Annotated[int | None, Query(ge=1)] = None,
    snapshot_kind: str | None = None,
    resource_identity: str | None = None,
    latest_per_identity: bool = False,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[NodeSnapshotSummary]:
    try:
        return list_node_snapshots(
            session,
            agent_system_id=agent_system_id,
            agent_system_key=agent_system_key,
            product_key=product_key,
            node_id=node_id,
            output_key=output_key,
            schema_version=schema_version,
            snapshot_kind=snapshot_kind,
            resource_identity=resource_identity,
            latest_per_identity=latest_per_identity,
            limit=limit,
        )
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/api/node-snapshots/{snapshot_id}", response_model=NodeSnapshotDetail)
def node_snapshot(snapshot_id: str, session: SessionDependency) -> NodeSnapshotDetail:
    try:
        return node_snapshot_detail(session, snapshot_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
