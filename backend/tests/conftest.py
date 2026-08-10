import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from autoeval_api.agent_systems.incident_triage.seed import ensure_seed_data
from autoeval_api.config import Settings
from autoeval_api.db import Base, configure_sqlite_foreign_keys
from autoeval_api.main import create_application
from autoeval_api.migrations import apply_migrations


@pytest.fixture
def session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    configure_sqlite_foreign_keys(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(engine)
    apply_migrations(engine)
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
    app = create_application(
        settings=settings,
        session_factory=session_factory,
        initialize_database=False,
        seed_on_start=False,
    )
    with TestClient(app) as test_client:
        yield test_client
