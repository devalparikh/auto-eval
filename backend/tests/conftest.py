import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from autoeval_api.agent_systems.incident_triage.seed import ensure_seed_data
from autoeval_api.app import create_application
from autoeval_api.config import Settings
from autoeval_api.db import build_session_factory, configure_sqlite_foreign_keys, create_schema


@pytest.fixture
def session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    configure_sqlite_foreign_keys(engine)
    create_schema(engine)
    factory = build_session_factory(engine)
    session = factory()
    ensure_seed_data(session)
    session.close()
    try:
        yield factory
    finally:
        engine.dispose()


@pytest.fixture
def client(session_factory):
    settings = Settings(
        AUTOEVAL_ENV="test",
        database_url="sqlite://",
        web_origins=["http://localhost:3000"],
        allowed_hosts=["testserver"],
    )
    engine = session_factory.kw["bind"]
    app = create_application(
        settings=settings,
        engine=engine,
        session_factory=session_factory,
        initialize_database=False,
        seed_on_start=False,
    )
    with TestClient(app) as test_client:
        yield test_client
