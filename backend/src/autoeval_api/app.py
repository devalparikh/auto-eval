from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from autoeval_api.agent_systems.seed import ensure_demo_runs, ensure_seed_data
from autoeval_api.api.middleware import RequestGuardMiddleware, SecurityHeadersMiddleware
from autoeval_api.api.routes import (
    artifacts,
    catalog,
    datasets,
    evaluations,
    node_snapshots,
    portfolio_snapshots,
    runtime_input_snapshots,
    traces,
    versions,
)
from autoeval_api.config import Settings, get_settings
from autoeval_api.db import SessionLocal, build_session_factory, create_schema
from autoeval_api.db import engine as default_engine
from autoeval_api.graph.registry import NodeHandlerRegistry, default_node_handler_registry
from autoeval_api.graph.runner import AgentGraphRunner
from autoeval_api.inference.registry import (
    InferenceProviderRegistry,
    default_provider_registry,
)
from autoeval_api.market_data import default_runtime_input_registry
from autoeval_api.services.evaluations import EvaluationService
from autoeval_api.services.scoring import ScoringRegistry, default_scoring_registry


def _infer_engine_from_session_factory(
    session_factory: Callable[[], Session],
) -> Engine | None:
    """Best-effort recovery of the bound engine when only a session_factory is given."""
    kw = getattr(session_factory, "kw", None)
    if isinstance(kw, dict) and isinstance(kw.get("bind"), Engine):
        return kw["bind"]
    try:
        session = session_factory()
    except Exception:
        return None
    try:
        bind = session.get_bind()
    except Exception:
        return None
    finally:
        session.close()
    return bind if isinstance(bind, Engine) else None


def create_application(
    settings: Settings | None = None,
    engine: Engine | None = None,
    session_factory: Callable[[], Session] | None = None,
    initialize_database: bool = True,
    seed_on_start: bool = True,
    provider_registry: InferenceProviderRegistry | None = None,
    node_registry: NodeHandlerRegistry | None = None,
    scoring_registry: ScoringRegistry | None = None,
    runner: AgentGraphRunner | None = None,
    evaluation_service: EvaluationService | None = None,
) -> FastAPI:
    settings = settings or get_settings()

    resolved_engine = engine
    if session_factory is None:
        if engine is not None:
            session_factory = build_session_factory(engine)
        else:
            session_factory = SessionLocal
            resolved_engine = default_engine
    elif resolved_engine is None:
        resolved_engine = _infer_engine_from_session_factory(session_factory)

    if provider_registry is None:
        provider_registry = (
            runner.provider_registry if runner is not None else default_provider_registry(settings)
        )
    node_registry = node_registry or default_node_handler_registry()
    scoring_registry = scoring_registry or default_scoring_registry()
    runner = runner or AgentGraphRunner(
        provider_registry,
        node_registry,
        default_runtime_input_registry(settings),
    )
    evaluation_service = evaluation_service or EvaluationService(
        session_factory, runner, scoring_registry
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if initialize_database:
            schema_engine = resolved_engine
            if schema_engine is None:
                raise ValueError(
                    "create_application: initialize_database=True requires an engine; "
                    "pass engine= explicitly, or a session_factory bound to one"
                )
            create_schema(schema_engine)
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
    app.state.settings = settings
    app.state.engine = resolved_engine

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
    app.include_router(artifacts.router)
    app.include_router(node_snapshots.router)
    app.include_router(portfolio_snapshots.router)
    app.include_router(runtime_input_snapshots.router)
    app.include_router(versions.router)
    app.include_router(traces.router)
    app.include_router(datasets.router)
    app.include_router(evaluations.router)
    return app


app = create_application()
