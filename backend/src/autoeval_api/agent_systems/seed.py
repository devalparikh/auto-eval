from collections.abc import Callable

from sqlalchemy.orm import Session

from autoeval_api.agent_systems.registry import builtin_system_plugins
from autoeval_api.graph.runner import AgentGraphRunner
from autoeval_api.services.scoring import ScoringRegistry


def ensure_seed_data(session: Session) -> None:
    for plugin in builtin_system_plugins():
        plugin.seed_data(session)


async def ensure_demo_runs(
    session_factory: Callable[[], Session],
    runner: AgentGraphRunner,
    scoring_registry: ScoringRegistry,
) -> None:
    for plugin in builtin_system_plugins():
        await plugin.demo_hook()(session_factory, runner, scoring_registry)
