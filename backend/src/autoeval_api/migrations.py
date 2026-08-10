from collections.abc import Iterable

from sqlalchemy import Engine, inspect, text

MIGRATION_VERSION = 1


def apply_migrations(engine: Engine) -> None:
    """Upgrade databases created by the original local MVP in place."""
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        )
        applied = {
            row[0] for row in connection.execute(text("SELECT version FROM schema_migrations"))
        }
        if MIGRATION_VERSION in applied:
            _create_integrity_triggers(connection)
            return

        _add_column_if_missing(
            connection,
            "prompts",
            "agent_system_id",
            "VARCHAR(36) REFERENCES agent_systems(id)",
        )
        _add_column_if_missing(
            connection,
            "datasets",
            "agent_system_id",
            "VARCHAR(36) REFERENCES agent_systems(id)",
        )
        _add_column_if_missing(
            connection,
            "traces",
            "origin_type",
            "VARCHAR(24) NOT NULL DEFAULT 'legacy_unknown'",
        )
        _add_column_if_missing(
            connection,
            "traces",
            "evaluation_run_id",
            "VARCHAR(36) REFERENCES eval_runs(id)",
        )
        _add_column_if_missing(
            connection,
            "traces",
            "evaluation_dataset_item_id",
            "VARCHAR(36) REFERENCES dataset_items(id)",
        )

        _backfill_system_ownership(connection)
        _backfill_trace_origins(connection)
        _require_no_duplicates(connection)
        _create_indexes(connection)
        _create_integrity_triggers(connection)
        connection.execute(
            text("INSERT INTO schema_migrations (version) VALUES (:version)"),
            {"version": MIGRATION_VERSION},
        )


def _add_column_if_missing(connection, table: str, column: str, definition: str) -> None:
    columns = {item["name"] for item in inspect(connection).get_columns(table)}
    if column not in columns:
        connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}"))


def _backfill_system_ownership(connection) -> None:
    system_ids = [row[0] for row in connection.execute(text("SELECT id FROM agent_systems"))]
    if not system_ids:
        return
    incident_id = connection.execute(
        text("SELECT id FROM agent_systems WHERE key = 'incident-triage'")
    ).scalar_one_or_none()
    fallback_id = incident_id or (system_ids[0] if len(system_ids) == 1 else None)
    if fallback_id is None:
        raise RuntimeError("Cannot infer agent-system ownership for legacy prompts and datasets")
    for table in ("prompts", "datasets"):
        connection.execute(
            text(f"UPDATE {table} SET agent_system_id = :system_id WHERE agent_system_id IS NULL"),
            {"system_id": fallback_id},
        )


def _backfill_trace_origins(connection) -> None:
    connection.execute(
        text(
            """
            UPDATE traces
            SET origin_type = 'evaluation',
                evaluation_run_id = (
                    SELECT eval_run_id FROM eval_item_results
                    WHERE eval_item_results.trace_id = traces.id LIMIT 1
                ),
                evaluation_dataset_item_id = (
                    SELECT dataset_item_id FROM eval_item_results
                    WHERE eval_item_results.trace_id = traces.id LIMIT 1
                )
            WHERE EXISTS (
                SELECT 1 FROM eval_item_results
                WHERE eval_item_results.trace_id = traces.id
            )
            """
        )
    )


def _require_no_duplicates(connection) -> None:
    checks: Iterable[tuple[str, str]] = (
        (
            "dataset trace memberships",
            """
            SELECT 1 FROM dataset_items
            WHERE source_trace_id IS NOT NULL
            GROUP BY dataset_version_id, source_trace_id HAVING COUNT(*) > 1 LIMIT 1
            """,
        ),
        (
            "evaluation item results",
            """
            SELECT 1 FROM eval_item_results
            GROUP BY eval_run_id, dataset_item_id, model_id HAVING COUNT(*) > 1 LIMIT 1
            """,
        ),
    )
    for label, statement in checks:
        if connection.execute(text(statement)).first() is not None:
            raise RuntimeError(
                f"Migration found duplicate {label}; review them before restarting AutoEval"
            )


def _create_indexes(connection) -> None:
    statements = (
        "CREATE INDEX IF NOT EXISTS ix_prompts_agent_system_id ON prompts (agent_system_id)",
        "CREATE INDEX IF NOT EXISTS ix_datasets_agent_system_id ON datasets (agent_system_id)",
        "CREATE INDEX IF NOT EXISTS ix_traces_origin_type ON traces (origin_type)",
        "CREATE INDEX IF NOT EXISTS ix_traces_evaluation_run_id ON traces (evaluation_run_id)",
        "CREATE INDEX IF NOT EXISTS ix_traces_evaluation_dataset_item_id "
        "ON traces (evaluation_dataset_item_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_dataset_version_source_trace "
        "ON dataset_items (dataset_version_id, source_trace_id) "
        "WHERE source_trace_id IS NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_eval_item_model "
        "ON eval_item_results (eval_run_id, dataset_item_id, model_id)",
    )
    for statement in statements:
        connection.execute(text(statement))


def _create_integrity_triggers(connection) -> None:
    statements = (
        """
        CREATE TRIGGER IF NOT EXISTS prevent_dataset_item_insert_into_final
        BEFORE INSERT ON dataset_items
        WHEN (SELECT status FROM dataset_versions WHERE id = NEW.dataset_version_id) != 'draft'
        BEGIN
            SELECT RAISE(ABORT, 'dataset_version_not_draft');
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS prevent_dataset_item_update_in_final
        BEFORE UPDATE ON dataset_items
        WHEN (SELECT status FROM dataset_versions WHERE id = OLD.dataset_version_id) != 'draft'
        BEGIN
            SELECT RAISE(ABORT, 'dataset_version_not_draft');
        END
        """,
    )
    for statement in statements:
        connection.execute(text(statement))
