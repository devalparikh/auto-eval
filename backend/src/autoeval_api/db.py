from collections.abc import Generator

from sqlalchemy import create_engine
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
    return create_engine(settings.database_url, **options)


engine = build_engine(get_settings())
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def create_schema() -> None:
    from autoeval_api import models  # noqa: F401

    Base.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
