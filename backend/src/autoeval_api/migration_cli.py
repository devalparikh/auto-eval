"""Explicit offline schema administration. Runtime never upgrades hosted databases."""

import argparse
import hashlib
import inspect as python_inspect
import re

from sqlalchemy import inspect, text

from autoeval_api.config import get_settings
from autoeval_api.db import Base, build_engine, create_schema
from autoeval_api.migrations import MIGRATION_VERSION, MIGRATIONS


def migration_digests():
    return {
        version: hashlib.sha256(python_inspect.getsource(fn).encode()).hexdigest()
        for version, fn in enumerate(MIGRATIONS, 1)
    }


def check_digests(connection, *, record=False, complete=True):
    from autoeval_api.models import MigrationChecksumRecord

    expected = migration_digests()
    stored = dict(
        connection.execute(text("SELECT version, digest FROM schema_migration_checksums")).all()
    )
    if any(expected.get(version) != value for version, value in stored.items()):
        raise RuntimeError("Migration checksum mismatch")
    if record:
        for version, value in expected.items():
            if version not in stored:
                connection.execute(
                    MigrationChecksumRecord.__table__.insert().values(version=version, digest=value)
                )
    elif complete and stored != expected:
        raise RuntimeError("Migration checksums missing; run autoeval-migrate upgrade")


def require_current_schema(engine):
    if engine is None or "schema_migrations" not in inspect(engine).get_table_names():
        raise RuntimeError("Run autoeval-migrate upgrade before starting the server")
    with engine.connect() as connection:
        versions = set(connection.execute(text("SELECT version FROM schema_migrations")).scalars())
    if versions != set(range(1, MIGRATION_VERSION + 1)):
        raise RuntimeError("Schema version mismatch; run autoeval-migrate upgrade")
    with engine.connect() as connection:
        check_digests(connection)


def upgrade(engine):
    from autoeval_api import models  # noqa: F401

    if engine.dialect.name == "sqlite":
        if "schema_migrations" in inspect(engine).get_table_names():
            with engine.connect() as connection:
                versions = set(
                    connection.execute(text("SELECT version FROM schema_migrations")).scalars()
                )
            if not versions.issubset(set(range(1, MIGRATION_VERSION + 1))):
                raise RuntimeError("Database is newer than this server")
        if "schema_migration_checksums" in inspect(engine).get_table_names():
            with engine.connect() as connection:
                check_digests(connection, complete=False)
        create_schema(engine)
        with engine.begin() as connection:
            check_digests(connection, record=True)
        return
    if engine.dialect.name != "postgresql":
        raise RuntimeError("Only SQLite and PostgreSQL are supported")
    # Legacy versions 1-14 contain SQLite-only DDL. A fresh PostgreSQL schema
    # starts from equivalent ORM models; never stamp an unknown existing schema.
    with engine.begin() as connection:
        connection.execute(text("SELECT pg_advisory_xact_lock(19482401)"))
        tables = inspect(connection).get_table_names()
        if "schema_migration_checksums" in tables:
            check_digests(connection, complete=False)
        if "schema_migrations" not in tables:
            if tables:
                raise RuntimeError("Refusing to adopt an unversioned nonempty PostgreSQL schema")
            Base.metadata.create_all(connection)
            connection.execute(
                text(
                    "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, "
                    "applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)"
                )
            )
            for version in range(1, 15):
                connection.execute(
                    text("INSERT INTO schema_migrations(version) VALUES (:v)"), {"v": version}
                )
        versions = set(connection.execute(text("SELECT version FROM schema_migrations")).scalars())
        if not versions.issubset(set(range(1, MIGRATION_VERSION + 1))):
            raise RuntimeError("Database is newer than this server")
        for version, migration in enumerate(MIGRATIONS, 1):
            if version not in versions:
                if version < 15:
                    raise RuntimeError("Unsupported PostgreSQL baseline")
                migration(connection)
                connection.execute(
                    text("INSERT INTO schema_migrations(version) VALUES (:v)"), {"v": version}
                )
        check_digests(connection, record=True)
    require_current_schema(engine)


def grant_runtime(engine, role):
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", role) or role in {
        "anon",
        "authenticated",
        "postgres",
        "service_role",
    }:
        raise RuntimeError("Use a dedicated backend runtime role")
    if engine.dialect.name != "postgresql":
        raise RuntimeError("Runtime roles apply only to PostgreSQL")
    with engine.begin() as connection:
        info = connection.execute(
            text("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=:role"), {"role": role}
        ).first()
        if not info or info[0] or info[1]:
            raise RuntimeError("Runtime role must exist without superuser or bypassrls")
        schema = connection.scalar(text("SELECT current_schema()"))
        quoted_schema = connection.dialect.identifier_preparer.quote(schema)
        connection.execute(text(f'GRANT USAGE ON SCHEMA {quoted_schema} TO "{role}"'))
        for table in sorted(set(Base.metadata.tables) | {"schema_migrations"}):
            command = (
                "SELECT"
                if table.startswith("schema_migration")
                else "SELECT, INSERT, UPDATE, DELETE"
            )
            connection.execute(text(f'GRANT {command} ON "{table}" TO "{role}"'))
            # Role is strictly validated above; table identifiers are product-owned.
            policy = "autoeval_runtime_" + role
            connection.execute(text(f'DROP POLICY IF EXISTS "{policy}" ON "{table}"'))
            connection.execute(
                text(
                    f'CREATE POLICY "{policy}" ON "{table}" TO "{role}" '
                    "USING (true) WITH CHECK (true)"
                )
            )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["status", "upgrade"])
    parser.add_argument("--runtime-role", help="Existing dedicated PostgreSQL DML role")
    args = parser.parse_args()
    engine = build_engine(get_settings())
    try:
        if args.command == "upgrade":
            upgrade(engine)
            if args.runtime_role:
                grant_runtime(engine, args.runtime_role)
        elif args.runtime_role:
            parser.error("--runtime-role requires upgrade")
        require_current_schema(engine)
        print(f"Schema current: {MIGRATION_VERSION}")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
