from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy.orm import Session

from autoeval_api.agent_systems.incident_triage.seed import ensure_demo_runs, ensure_seed_data
from autoeval_api.api.middleware import RequestGuardMiddleware, SecurityHeadersMiddleware
from autoeval_api.api.routes import catalog, datasets, evaluations, traces, versions
from autoeval_api.config import Settings, get_settings
from autoeval_api.db import SessionLocal, create_schema
from autoeval_api.graph.registry import NodeHandlerRegistry, default_node_handler_registry
from autoeval_api.graph.runner import AgentGraphRunner
from autoeval_api.inference.registry import (
    InferenceProviderRegistry,
    default_provider_registry,
)
from autoeval_api.services.evaluations import EvaluationService
from autoeval_api.services.scoring import ScoringRegistry, default_scoring_registry


def create_application(
    settings: Settings | None = None,
    session_factory: Callable[[], Session] = SessionLocal,
    initialize_database: bool = True,
    seed_on_start: bool = True,
    provider_registry: InferenceProviderRegistry | None = None,
    node_registry: NodeHandlerRegistry | None = None,
    scoring_registry: ScoringRegistry | None = None,
    runner: AgentGraphRunner | None = None,
    evaluation_service: EvaluationService | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    if provider_registry is None:
        provider_registry = (
            runner.provider_registry if runner is not None else default_provider_registry(settings)
        )
    node_registry = node_registry or default_node_handler_registry()
    scoring_registry = scoring_registry or default_scoring_registry()
    runner = runner or AgentGraphRunner(provider_registry, node_registry)
    evaluation_service = evaluation_service or EvaluationService(
        session_factory, runner, scoring_registry
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if initialize_database:
            create_schema()
        if seed_on_start:
            session = session_factory()
            try:
                ensure_seed_data(session)
            finally:
                session.close()
            await ensure_demo_runs(session_factory, runner, scoring_registry)
        yield

    app = FastAPI(
        title="AutoEval API",
        version="0.1.0",
        docs_url=None if settings.production else "/docs",
        redoc_url=None if settings.production else "/redoc",
        openapi_url=None if settings.production else "/openapi.json",
        lifespan=lifespan,
    )
    app.state.runner = runner
    app.state.provider_registry = provider_registry
    app.state.evaluation_service = evaluation_service
    app.state.session_factory = session_factory

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.web_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "OPTIONS"],
        allow_headers=["Content-Type", "Accept"],
    )
    app.add_middleware(RequestGuardMiddleware, settings=settings)
    app.add_middleware(SecurityHeadersMiddleware)

    app.include_router(catalog.router)
    app.include_router(versions.router)
    app.include_router(traces.router)
    app.include_router(datasets.router)
    app.include_router(evaluations.router)
    return app


app = create_application()
