from copy import deepcopy

from sqlalchemy.orm import Session

from autoeval_api.models import AgentSystemRecord, PortfolioSnapshotRecord
from autoeval_api.services.portfolio_snapshots import create_portfolio_snapshot

SYNTHETIC_SNAPSHOT_ID = "synthetic-indexed-portfolio-v2"
SYNTHETIC_INSUFFICIENT_SHARES_SNAPSHOT_ID = "synthetic-indexed-portfolio-low-shares-v2"

SYNTHETIC_SNAPSHOT_DOCUMENT = {
    "schema_version": 1,
    "as_of": "2026-08-10T16:00:00Z",
    "is_synthetic": True,
    "positions": [
        {
            "position_id": "synthetic-tactical-nvda",
            "symbol": "NVDA",
            "instrument_type": "equity",
            "shares": 200,
            "pledged_shares": 100,
            "weight": 0.12,
            "bucket": "tactical",
            "covered_calls_allowed": True,
            "assignment_acceptable": True,
            "do_not_touch": False,
            "min_exit_price": 155.0,
            "tags": ["ai", "semiconductor"],
        },
        {
            "position_id": "synthetic-core-msft",
            "symbol": "MSFT",
            "instrument_type": "equity",
            "shares": 60,
            "pledged_shares": 0,
            "weight": 0.1,
            "bucket": "core",
            "covered_calls_allowed": False,
            "assignment_acceptable": False,
            "do_not_touch": True,
            "tags": ["quality", "software"],
        },
    ],
}


def ensure_synthetic_portfolio_snapshots(
    session: Session,
    owner: AgentSystemRecord,
) -> tuple[PortfolioSnapshotRecord, PortfolioSnapshotRecord]:
    eligible = create_portfolio_snapshot(
        session,
        owner,
        snapshot_id=SYNTHETIC_SNAPSHOT_ID,
        resource_identity=SYNTHETIC_SNAPSHOT_ID,
        label="Synthetic current portfolio",
        as_of=SYNTHETIC_SNAPSHOT_DOCUMENT["as_of"],
        source_kind="synthetic",
        is_synthetic=True,
        document=deepcopy(SYNTHETIC_SNAPSHOT_DOCUMENT),
    )
    insufficient_document = deepcopy(SYNTHETIC_SNAPSHOT_DOCUMENT)
    insufficient_document["positions"][0]["shares"] = 80
    insufficient_document["positions"][0]["pledged_shares"] = 0
    insufficient = create_portfolio_snapshot(
        session,
        owner,
        snapshot_id=SYNTHETIC_INSUFFICIENT_SHARES_SNAPSHOT_ID,
        resource_identity=SYNTHETIC_INSUFFICIENT_SHARES_SNAPSHOT_ID,
        label="Synthetic portfolio with insufficient covered shares",
        as_of=insufficient_document["as_of"],
        source_kind="synthetic",
        is_synthetic=True,
        document=insufficient_document,
    )
    return eligible, insufficient
