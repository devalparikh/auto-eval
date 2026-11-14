"""Optional isolated PostgreSQL tests; CI supplies a disposable service URL."""

import os
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import DBAPIError

from autoeval_api.migration_cli import require_current_schema, upgrade
from autoeval_api.migrations import MIGRATION_VERSION


def test_sqlite_upgrade_is_deliberate_and_idempotent(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/upgrade.db")
    with pytest.raises(RuntimeError):
        require_current_schema(engine)
    upgrade(engine)
    upgrade(engine)
    require_current_schema(engine)
    assert "feed_keys" in inspect(engine).get_table_names()
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO schema_migrations(version) VALUES (9999)"))
    with pytest.raises(RuntimeError):
        require_current_schema(engine)
    with pytest.raises(RuntimeError, match="newer"):
        upgrade(engine)
    engine.dispose()


@pytest.fixture
def postgres():
    url = os.environ.get("AUTOEVAL_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("Set AUTOEVAL_TEST_POSTGRES_URL to an isolated test PostgreSQL database")
    # Unique schema; no dropping or modifying tables belonging to other tests.
    base = create_engine(url)
    schema = "test_" + uuid4().hex
    with base.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    try:
        yield engine
    finally:
        engine.dispose()
        with base.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        base.dispose()


def test_postgres_fresh_upgrade_repeat_and_immutable_records(postgres):
    upgrade(postgres)
    upgrade(postgres)
    require_current_schema(postgres)
    with postgres.begin() as connection:
        assert (
            connection.scalar(text("SELECT max(version) FROM schema_migrations"))
            == MIGRATION_VERSION
        )
        connection.execute(
            text("INSERT INTO feed_applications VALUES ('app','preview','test','{}',1)")
        )
        connection.execute(
            text(
                "INSERT INTO feed_objects(application_id,kind,id,body,expires,revoked) "
                "VALUES ('app','experiment','id','{}',0,false)"
            )
        )
    with pytest.raises(DBAPIError), postgres.begin() as connection:
        connection.execute(text("UPDATE feed_objects SET body='{}' WHERE id='id'"))
    with pytest.raises(DBAPIError), postgres.begin() as connection:
        connection.execute(text("DELETE FROM feed_objects WHERE id='id'"))
    with postgres.begin() as connection:
        connection.execute(text("DELETE FROM schema_migrations WHERE version=9999"))


def test_postgres_rejects_unversioned_existing_database(postgres):
    with postgres.begin() as connection:
        connection.execute(text("CREATE TABLE unrelated (id INTEGER)"))
    with pytest.raises(RuntimeError, match="unversioned"):
        upgrade(postgres)
    assert inspect(postgres).get_table_names() == ["unrelated"]


def test_postgres_checksum_drift_blocks_upgrade(postgres):
    upgrade(postgres)
    with postgres.begin() as connection:
        connection.execute(
            text("UPDATE schema_migration_checksums SET digest='tampered' WHERE version=15")
        )
    with pytest.raises(RuntimeError, match="checksum"):
        upgrade(postgres)
    with pytest.raises(RuntimeError, match="checksum"):
        require_current_schema(postgres)


def test_postgres_rls_and_runtime_role_cannot_migrate(postgres):
    from autoeval_api.migration_cli import grant_runtime

    upgrade(postgres)
    role = "runtime_" + uuid4().hex
    browser = "browser_" + uuid4().hex
    with postgres.begin() as connection:
        connection.execute(text(f'CREATE ROLE "{role}"'))
        connection.execute(text(f'CREATE ROLE "{browser}"'))
        schema = connection.scalar(text("SELECT current_schema()"))
        connection.execute(text(f'GRANT USAGE ON SCHEMA "{schema}" TO "{browser}"'))
        # Even an accidental explicit table grant is denied by RLS.
        connection.execute(text(f'GRANT SELECT ON feed_keys TO "{browser}"'))
    try:
        grant_runtime(postgres, role)
        with postgres.begin() as connection:
            connection.execute(text(f'SET LOCAL ROLE "{role}"'))
            connection.execute(
                text("INSERT INTO feed_applications VALUES ('app','preview','test','{}',1)")
            )
            assert connection.scalar(text("SELECT count(*) FROM feed_applications")) == 1
        with pytest.raises(DBAPIError), postgres.begin() as connection:
            connection.execute(text(f'SET LOCAL ROLE "{role}"'))
            connection.execute(text("DELETE FROM schema_migrations"))
        with postgres.begin() as connection:
            connection.execute(text(f'SET LOCAL ROLE "{browser}"'))
            assert connection.scalar(text("SELECT count(*) FROM feed_keys")) == 0
    finally:
        with postgres.begin() as connection:
            for name in (role, browser):
                connection.execute(text(f'DROP OWNED BY "{name}"'))
                connection.execute(text(f'DROP ROLE "{name}"'))
