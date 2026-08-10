from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from autoeval_api.api.dependencies import SessionDependency, get_or_404
from autoeval_api.models import AgentSystemRecord, PortfolioSnapshotRecord
from autoeval_api.schemas import PortfolioSnapshotDetail, PortfolioSnapshotSummary
from autoeval_api.services.portfolio_snapshots import (
    list_portfolio_snapshots,
    portfolio_snapshot_detail,
    portfolio_snapshot_summary,
)

router = APIRouter()


@router.get(
    "/api/portfolio-snapshots",
    response_model=list[PortfolioSnapshotSummary],
)
def portfolio_snapshots(
    session: SessionDependency,
    agent_system_key: str | None = None,
    synthetic_only: bool = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> list[PortfolioSnapshotSummary]:
    agent_system_id = None
    if agent_system_key is not None:
        owner = session.query(AgentSystemRecord).filter_by(key=agent_system_key).first()
        if owner is None:
            raise HTTPException(status_code=404, detail="Agent system not found")
        agent_system_id = owner.id

    records = list_portfolio_snapshots(session, agent_system_id)
    if synthetic_only:
        records = [record for record in records if record.is_synthetic]
    return [portfolio_snapshot_summary(record) for record in records[:limit]]


@router.get(
    "/api/portfolio-snapshots/{snapshot_id}",
    response_model=PortfolioSnapshotDetail,
)
def portfolio_snapshot(
    snapshot_id: str,
    session: SessionDependency,
) -> PortfolioSnapshotDetail:
    record = get_or_404(session, PortfolioSnapshotRecord, snapshot_id, "Portfolio snapshot")
    try:
        return portfolio_snapshot_detail(record)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
