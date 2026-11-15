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
    assert_pending_table_keys(engine)
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


@pytest.mark.parametrize("existing", [False, True])
def test_runtime_temp_shadow_cannot_mutate_final_items(postgres, monkeypatch, existing):
    from sqlalchemy.orm import Session

    from autoeval_api import migration_cli
    from autoeval_api.migration_cli import grant_runtime
    from autoeval_api.models import (
        AgentSystemRecord,
        DatasetItemRecord,
        DatasetRecord,
        DatasetVersionRecord,
    )

    if existing:
        # Build a genuine v18 database with the historical trigger and digests,
        # then run the appended migration through the supported upgrade path.
        with monkeypatch.context() as patch:
            patch.setattr(migration_cli, "MIGRATIONS", migration_cli.MIGRATIONS[:18])
            patch.setattr(migration_cli, "MIGRATION_VERSION", 18)
            upgrade(postgres)
    upgrade(postgres)
    role = "runtime_" + uuid4().hex
    with postgres.begin() as connection:
        schema = connection.scalar(text("SELECT current_schema()"))
        connection.execute(text(f'CREATE ROLE "{role}"'))
    try:
        grant_runtime(postgres, role)
        with Session(postgres) as session:
            agent = AgentSystemRecord(key="test", name="Test")
            session.add(agent)
            session.flush()
            dataset = DatasetRecord(agent_system_id=agent.id, key="test", name="Test")
            session.add(dataset)
            session.flush()
            final = DatasetVersionRecord(dataset_id=dataset.id, version=1)
            draft = DatasetVersionRecord(dataset_id=dataset.id, version=2)
            session.add_all([final, draft])
            session.flush()
            item = DatasetItemRecord(
                dataset_version_id=final.id, input={"fixed": True}, expected={}
            )
            editable = DatasetItemRecord(dataset_version_id=draft.id, input={}, expected={})
            session.add_all([item, editable])
            session.flush()
            item_id, version_id, editable_id = item.id, final.id, editable.id
            final.status = "final"
            session.commit()
        with postgres.connect() as connection:
            connection.execute(text(f'SET LOCAL ROLE "{role}"'))
            connection.execute(text("CREATE TEMP TABLE dataset_versions (id text, status text)"))
            connection.execute(
                text("INSERT INTO pg_temp.dataset_versions VALUES (:id, 'draft')"),
                {"id": version_id},
            )
            connection.commit()
            for sql in (
                f'UPDATE "{schema}".dataset_items SET input=\'{{"tampered": true}}\' WHERE id=:id',
                f'DELETE FROM "{schema}".dataset_items WHERE id=:id',
            ):
                connection.execute(text(f'SET LOCAL ROLE "{role}"'))
                with pytest.raises(DBAPIError, match="dataset_version_not_draft"):
                    connection.execute(text(sql), {"id": item_id})
                connection.rollback()
            connection.execute(text(f'SET LOCAL ROLE "{role}"'))
            # A real draft stays editable even with a TEMP shadow; missing parent
            # fails in the guard itself rather than depending on FK enforcement.
            connection.execute(
                text(
                    f'UPDATE "{schema}".dataset_items '
                    "SET input='{\"allowed\": true}' WHERE id=:id"
                ),
                {"id": editable_id},
            )
            connection.commit()
            connection.execute(text(f'SET LOCAL ROLE "{role}"'))
            with pytest.raises(DBAPIError, match="dataset_version_not_draft"):
                connection.execute(
                    text(
                        f'UPDATE "{schema}".dataset_items '
                        "SET dataset_version_id='missing' WHERE id=:id"
                    ),
                    {"id": editable_id},
                )
            connection.rollback()
            assert connection.scalar(
                text(f'SELECT input FROM "{schema}".dataset_items WHERE id=:id'), {"id": item_id}
            ) == {"fixed": True}
            connection.execute(text("DROP TABLE pg_temp.dataset_versions"))
            connection.execute(text("RESET ROLE"))
            connection.commit()
        with postgres.connect() as connection:
            row = connection.execute(
                text(
                    "SELECT prosecdef, proconfig FROM pg_proc "
                    "WHERE oid = 'autoeval_dataset_item_guard()'::regprocedure"
                )
            ).one()
            assert row[0] is False
            assert row[1] == [f"search_path=pg_catalog, {schema}, pg_temp"]
    finally:
        with postgres.begin() as connection:
            connection.execute(text(f'DROP OWNED BY "{role}"'))
            connection.execute(text(f'DROP ROLE "{role}"'))


def test_postgres_v19_upgrade_adds_backend_only_pending_table(postgres, monkeypatch):
    from autoeval_api import migration_cli

    # A genuine v19 database predates the pending table entirely.
    with monkeypatch.context() as patch:
        patch.setattr(migration_cli, "MIGRATIONS", migration_cli.MIGRATIONS[:19])
        patch.setattr(migration_cli, "MIGRATION_VERSION", 19)
        upgrade(postgres)
    with postgres.begin() as connection:
        connection.execute(text("DROP TABLE hosted_pending_registrations"))
    upgrade(postgres)
    upgrade(postgres)
    require_current_schema(postgres)
    assert_pending_table_keys(postgres)
    with postgres.connect() as connection:
        assert connection.scalar(
            text(
                "SELECT relrowsecurity FROM pg_class "
                "WHERE oid = 'hosted_pending_registrations'::regclass"
            )
        )
        assert not connection.scalar(
            text("SELECT has_table_privilege('public', 'hosted_pending_registrations', 'SELECT')")
        )


def assert_pending_table_keys(engine):
    """One row per subject and one subject per cookie digest, enforced by the schema."""
    schema = inspect(engine)
    assert schema.get_pk_constraint("hosted_pending_registrations")["constrained_columns"] == [
        "subject"
    ]
    unique = [
        constraint["column_names"]
        for constraint in schema.get_unique_constraints("hosted_pending_registrations")
    ] + [
        index["column_names"]
        for index in schema.get_indexes("hosted_pending_registrations")
        if index["unique"]
    ]
    assert ["digest"] in unique


def test_postgres_v20_populated_upgrade_preserves_history_revokes_legacy(postgres, monkeypatch):
    from autoeval_api import migration_cli

    with monkeypatch.context() as patch:
        patch.setattr(migration_cli, "MIGRATIONS", migration_cli.MIGRATIONS[:20])
        patch.setattr(migration_cli, "MIGRATION_VERSION", 20)
        upgrade(postgres)
    # Remove future ORM columns/tables to reproduce the shipped v20 layout.
    with postgres.begin() as connection:
        connection.execute(text("DROP TABLE feed_capture_settings"))
        for table, columns in [
            ("feed_keys", ("label", "created", "retire_at")),
            ("feed_objects", ("parent_id", "request_digest")),
        ]:
            for column in columns:
                connection.execute(text(f"ALTER TABLE {table} DROP COLUMN {column}"))
        connection.execute(
            text("INSERT INTO feed_applications VALUES ('app','preview','History','{}',7)")
        )
        connection.execute(
            text(
                "INSERT INTO feed_keys(id,application_id,digest,scope,expires,revoked) "
                "VALUES ('key','app','digest','traces:write',9999999999,false)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO feed_objects(application_id,kind,id,body,expires,revoked) "
                "VALUES ('app','experiment','old','{}',0,false)"
            )
        )
    upgrade(postgres)
    upgrade(postgres)
    with postgres.connect() as connection:
        assert connection.scalar(text("SELECT revoked FROM feed_keys WHERE id='key'"))
        assert (
            connection.scalar(text("SELECT count(*) FROM feed_objects WHERE kind='experiment'"))
            == 1
        )
        assert connection.execute(
            text(
                "SELECT production_enabled, categories_initialized, retention_days "
                "FROM feed_capture_settings"
            )
        ).one() == (False, True, 7)
        assert connection.scalar(
            text("SELECT relrowsecurity FROM pg_class WHERE oid='feed_capture_settings'::regclass")
        )
