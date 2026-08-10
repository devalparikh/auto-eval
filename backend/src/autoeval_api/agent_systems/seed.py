from collections.abc import Callable

from sqlalchemy.orm import Session

from autoeval_api.agent_systems.incident_triage.seed import (
    ensure_demo_runs as ensure_incident_demo_runs,
)
from autoeval_api.agent_systems.incident_triage.seed import (
    ensure_seed_data as ensure_incident_seed_data,
)
from autoeval_api.agent_systems.portfolio_analyst.seed import (
    ensure_demo_runs as ensure_portfolio_demo_runs,
)
from autoeval_api.agent_systems.portfolio_analyst.seed import (
    ensure_seed_data as ensure_portfolio_seed_data,
)
from autoeval_api.graph.runner import AgentGraphRunner
from autoeval_api.services.scoring import ScoringRegistry


def ensure_seed_data(session: Session) -> None:
    ensure_incident_seed_data(session)
    ensure_portfolio_seed_data(session)


async def ensure_demo_runs(
    session_factory: Callable[[], Session],
    runner: AgentGraphRunner,
    scoring_registry: ScoringRegistry,
) -> None:
    await ensure_incident_demo_runs(session_factory, runner, scoring_registry)
    await ensure_portfolio_demo_runs(session_factory, runner, scoring_registry)
