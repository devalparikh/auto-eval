from collections.abc import Generator

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from autoeval_api.config import Settings, get_settings


class Base(DeclarativeBase):
    pass


def build_engine(settings: Settings):
    options: dict[str, object] = {}
    if settings.database_url.startswith("sqlite"):
        options["connect_args"] = {"check_same_thread": False}
        if settings.database_url in {"sqlite://", "sqlite:///:memory:"}:
            options["poolclass"] = StaticPool
    engine = create_engine(settings.database_url, **options)
    configure_sqlite_foreign_keys(engine)
    return engine


def build_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def configure_sqlite_foreign_keys(target_engine: Engine) -> None:
    if target_engine.dialect.name != "sqlite":
        return

    @event.listens_for(target_engine, "connect")
    def enable_foreign_keys(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


engine = build_engine(get_settings())
SessionLocal = build_session_factory(engine)


def create_schema(engine: Engine) -> None:
    from autoeval_api import models  # noqa: F401
    from autoeval_api.migrations import apply_migrations

    Base.metadata.create_all(engine)
    apply_migrations(engine)


def get_session() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
