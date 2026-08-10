"""CLI entrypoint for seeding every built-in agent system."""

import asyncio

from autoeval_api.agent_systems.incident_triage.definition import INCIDENT_GRAPH, INCIDENT_PROMPT
from autoeval_api.agent_systems.incident_triage.seed import DATASET_ITEMS
from autoeval_api.agent_systems.seed import ensure_demo_runs as ensure_all_demo_runs
from autoeval_api.agent_systems.seed import ensure_seed_data
from autoeval_api.config import get_settings
from autoeval_api.db import SessionLocal, create_schema
from autoeval_api.graph.runner import AgentGraphRunner
from autoeval_api.inference.registry import default_provider_registry
from autoeval_api.services.scoring import default_scoring_registry

__all__ = [
    "DATASET_ITEMS",
    "INCIDENT_GRAPH",
    "INCIDENT_PROMPT",
    "ensure_demo_runs",
    "ensure_seed_data",
]


async def main() -> None:
    create_schema()
    await ensure_demo_runs()


async def ensure_demo_runs(
    session_factory=SessionLocal,
    runner: AgentGraphRunner | None = None,
) -> None:
    runner = runner or AgentGraphRunner(default_provider_registry(get_settings()))
    await ensure_all_demo_runs(session_factory, runner, default_scoring_registry())


if __name__ == "__main__":
    asyncio.run(main())
