from collections.abc import Iterable

from sqlalchemy import Engine, inspect, text

MIGRATION_VERSION = 9


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
        if 1 not in applied:
            _apply_version_one(connection)
            connection.execute(text("INSERT INTO schema_migrations (version) VALUES (1)"))
        if 2 not in applied:
            _apply_version_two(connection)
            connection.execute(text("INSERT INTO schema_migrations (version) VALUES (2)"))
        if 3 not in applied:
            _apply_version_three(connection)
            connection.execute(text("INSERT INTO schema_migrations (version) VALUES (3)"))
        if 4 not in applied:
            _apply_version_four(connection)
            connection.execute(text("INSERT INTO schema_migrations (version) VALUES (4)"))
        if 5 not in applied:
            _apply_version_five(connection)
            connection.execute(text("INSERT INTO schema_migrations (version) VALUES (5)"))
        if 6 not in applied:
            _apply_version_six(connection)
            connection.execute(text("INSERT INTO schema_migrations (version) VALUES (6)"))
        if 7 not in applied:
            _apply_version_seven(connection)
            connection.execute(text("INSERT INTO schema_migrations (version) VALUES (7)"))
        if 8 not in applied:
            _apply_version_eight(connection)
            connection.execute(text("INSERT INTO schema_migrations (version) VALUES (8)"))
        if 9 not in applied:
            _apply_version_nine(connection)
            connection.execute(text("INSERT INTO schema_migrations (version) VALUES (9)"))
        _create_integrity_triggers(connection)


def _apply_version_one(connection) -> None:
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


def _apply_version_two(connection) -> None:
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS portfolio_snapshots (
                id VARCHAR(120) PRIMARY KEY,
                agent_system_id VARCHAR(36) NOT NULL REFERENCES agent_systems(id),
                source_trace_id VARCHAR(36) REFERENCES traces(id),
                schema_version INTEGER NOT NULL,
                label VARCHAR(200) NOT NULL,
                as_of VARCHAR(64) NOT NULL,
                source_kind VARCHAR(40) NOT NULL,
                is_synthetic BOOLEAN NOT NULL DEFAULT 0,
                content_hash VARCHAR(64) NOT NULL,
                document JSON NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_portfolio_snapshot_system_hash
                    UNIQUE (agent_system_id, content_hash)
            )
            """
        )
    )
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_portfolio_snapshots_agent_system_id "
            "ON portfolio_snapshots (agent_system_id)"
        )
    )
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_portfolio_snapshots_source_trace_id "
            "ON portfolio_snapshots (source_trace_id)"
        )
    )
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_portfolio_snapshots_source_kind "
            "ON portfolio_snapshots (source_kind)"
        )
    )


def _apply_version_three(connection) -> None:
    if _table_exists(connection, "traces"):
        _add_column_if_missing(
            connection,
            "traces",
            "prompt_version_ids",
            "JSON NOT NULL DEFAULT '{}'",
        )
    if _table_exists(connection, "eval_runs"):
        _add_column_if_missing(
            connection,
            "eval_runs",
            "prompt_version_ids",
            "JSON NOT NULL DEFAULT '{}'",
        )
    if _table_exists(connection, "trace_spans"):
        _add_column_if_missing(
            connection,
            "trace_spans",
            "prompt_version_id",
            "VARCHAR(36) REFERENCES prompt_versions(id)",
        )
        if _table_exists(connection, "traces"):
            connection.execute(
                text(
                    """
                    UPDATE trace_spans
                    SET prompt_version_id = (
                        SELECT prompt_version_id FROM traces
                        WHERE traces.id = trace_spans.trace_id
                    )
                    WHERE node_kind = 'llm' AND prompt_version_id IS NULL
                    """
                )
            )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_trace_spans_prompt_version_id "
                "ON trace_spans (prompt_version_id)"
            )
        )


def _apply_version_four(connection) -> None:
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS agent_input_samples (
                id VARCHAR(36) PRIMARY KEY,
                agent_system_id VARCHAR(36) NOT NULL REFERENCES agent_systems(id),
                source_trace_id VARCHAR(36) NOT NULL REFERENCES traces(id),
                input JSON NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_agent_input_sample_source_trace
                    UNIQUE (agent_system_id, source_trace_id)
            )
            """
        )
    )
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_agent_input_samples_agent_system_id "
            "ON agent_input_samples (agent_system_id)"
        )
    )
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_agent_input_samples_source_trace_id "
            "ON agent_input_samples (source_trace_id)"
        )
    )


def _apply_version_five(connection) -> None:
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS runtime_input_snapshots (
                id VARCHAR(36) PRIMARY KEY,
                agent_system_id VARCHAR(36) NOT NULL REFERENCES agent_systems(id),
                source_trace_id VARCHAR(36) REFERENCES traces(id),
                node_id VARCHAR(160) NOT NULL,
                source_key VARCHAR(120) NOT NULL,
                schema_version INTEGER NOT NULL,
                label VARCHAR(200) NOT NULL,
                observed_at DATETIME NOT NULL,
                fetched_at DATETIME NOT NULL,
                provider VARCHAR(120) NOT NULL,
                source_kind VARCHAR(40) NOT NULL,
                is_synthetic BOOLEAN NOT NULL DEFAULT 0,
                content_hash VARCHAR(64) NOT NULL,
                payload JSON NOT NULL,
                provenance JSON NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_runtime_input_snapshot_system_hash
                    UNIQUE (agent_system_id, content_hash),
                CONSTRAINT uq_runtime_input_snapshot_trace_node_source
                    UNIQUE (source_trace_id, node_id, source_key)
            )
            """
        )
    )
    for statement in (
        "CREATE INDEX IF NOT EXISTS ix_runtime_input_snapshots_agent_system_id "
        "ON runtime_input_snapshots (agent_system_id)",
        "CREATE INDEX IF NOT EXISTS ix_runtime_input_snapshots_source_trace_id "
        "ON runtime_input_snapshots (source_trace_id)",
        "CREATE INDEX IF NOT EXISTS ix_runtime_input_snapshots_node_id "
        "ON runtime_input_snapshots (node_id)",
        "CREATE INDEX IF NOT EXISTS ix_runtime_input_snapshots_source_key "
        "ON runtime_input_snapshots (source_key)",
        "CREATE INDEX IF NOT EXISTS ix_runtime_input_snapshots_provider "
        "ON runtime_input_snapshots (provider)",
        "CREATE INDEX IF NOT EXISTS ix_runtime_input_snapshots_source_kind "
        "ON runtime_input_snapshots (source_kind)",
    ):
        connection.execute(text(statement))
    if _table_exists(connection, "dataset_items"):
        _add_column_if_missing(
            connection,
            "dataset_items",
            "runtime_input_snapshot_ids",
            "JSON NOT NULL DEFAULT '{}'",
        )
    if _table_exists(connection, "traces"):
        _add_column_if_missing(
            connection,
            "traces",
            "runtime_input_snapshot_ids",
            "JSON NOT NULL DEFAULT '{}'",
        )
    if _table_exists(connection, "trace_spans"):
        _add_column_if_missing(
            connection,
            "trace_spans",
            "runtime_input_snapshot_id",
            "VARCHAR(36) REFERENCES runtime_input_snapshots(id)",
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_trace_spans_runtime_input_snapshot_id "
                "ON trace_spans (runtime_input_snapshot_id)"
            )
        )


def _apply_version_six(connection) -> None:
    if _table_exists(connection, "traces"):
        _add_column_if_missing(
            connection,
            "traces",
            "node_snapshot_ids",
            "JSON NOT NULL DEFAULT '{}'",
        )
    if not _table_exists(connection, "trace_spans"):
        return
    _add_column_if_missing(
        connection,
        "trace_spans",
        "node_snapshot_id",
        "VARCHAR(120)",
    )
    _add_column_if_missing(connection, "trace_spans", "snapshot_role", "VARCHAR(24)")
    _add_column_if_missing(
        connection,
        "trace_spans",
        "snapshot_resolution_mode",
        "VARCHAR(24)",
    )
    _add_column_if_missing(
        connection,
        "trace_spans",
        "snapshot_metadata",
        "JSON NOT NULL DEFAULT '{}'",
    )
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_trace_spans_node_snapshot_id "
            "ON trace_spans (node_snapshot_id)"
        )
    )
    trace_columns = (
        {item["name"] for item in inspect(connection).get_columns("traces")}
        if _table_exists(connection, "traces")
        else set()
    )
    span_columns = {item["name"] for item in inspect(connection).get_columns("trace_spans")}
    if "origin_type" in trace_columns:
        connection.execute(
            text(
                """
                UPDATE trace_spans
                SET node_snapshot_id = runtime_input_snapshot_id,
                    snapshot_role = CASE
                        WHEN (SELECT origin_type FROM traces WHERE traces.id = trace_spans.trace_id)
                            = 'evaluation' THEN 'consumed'
                        ELSE 'produced'
                    END,
                    snapshot_resolution_mode = CASE
                        WHEN (SELECT origin_type FROM traces WHERE traces.id = trace_spans.trace_id)
                            = 'evaluation' THEN 'replayed'
                        ELSE 'live'
                    END
                WHERE runtime_input_snapshot_id IS NOT NULL AND node_snapshot_id IS NULL
                """
            )
        )
    else:
        connection.execute(
            text(
                """
                UPDATE trace_spans
                SET node_snapshot_id = runtime_input_snapshot_id,
                    snapshot_role = 'produced',
                    snapshot_resolution_mode = 'live'
                WHERE runtime_input_snapshot_id IS NOT NULL AND node_snapshot_id IS NULL
                """
            )
        )
    portfolio_columns = (
        {item["name"] for item in inspect(connection).get_columns("portfolio_snapshots")}
        if _table_exists(connection, "portfolio_snapshots")
        else set()
    )
    if "node_id" in span_columns and "source_trace_id" in portfolio_columns:
        connection.execute(
            text(
                """
                UPDATE trace_spans
                SET node_snapshot_id = (
                        SELECT id FROM portfolio_snapshots
                        WHERE portfolio_snapshots.source_trace_id = trace_spans.trace_id
                        LIMIT 1
                    ),
                    snapshot_role = 'produced',
                    snapshot_resolution_mode = 'computed'
                WHERE node_id = 'persist_portfolio_snapshot'
                  AND node_snapshot_id IS NULL
                  AND EXISTS (
                      SELECT 1 FROM portfolio_snapshots
                      WHERE portfolio_snapshots.source_trace_id = trace_spans.trace_id
                  )
                """
            )
        )
    if "node_id" in span_columns and "request_input" in trace_columns and portfolio_columns:
        connection.execute(
            text(
                """
                UPDATE trace_spans
                SET node_snapshot_id = (
                        SELECT json_extract(traces.request_input, '$.snapshot_id')
                        FROM traces WHERE traces.id = trace_spans.trace_id
                    ),
                    snapshot_role = 'consumed',
                    snapshot_resolution_mode = 'resolved'
                WHERE node_id = 'resolve_portfolio_snapshot'
                  AND node_snapshot_id IS NULL
                  AND EXISTS (
                      SELECT 1 FROM portfolio_snapshots
                      WHERE portfolio_snapshots.id = (
                          SELECT json_extract(traces.request_input, '$.snapshot_id')
                          FROM traces WHERE traces.id = trace_spans.trace_id
                      )
                  )
                """
            )
        )


def _apply_version_seven(connection) -> None:
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS node_output_snapshots (
                id VARCHAR(120) PRIMARY KEY,
                agent_system_id VARCHAR(36) NOT NULL REFERENCES agent_systems(id),
                source_trace_id VARCHAR(36) REFERENCES traces(id),
                node_id VARCHAR(160) NOT NULL,
                node_kind VARCHAR(40) NOT NULL,
                output_key VARCHAR(120) NOT NULL,
                snapshot_kind VARCHAR(40) NOT NULL,
                schema_version INTEGER NOT NULL,
                label VARCHAR(200) NOT NULL,
                observed_at DATETIME NOT NULL,
                captured_at DATETIME NOT NULL,
                source VARCHAR(120) NOT NULL,
                provider VARCHAR(120),
                capture_mode VARCHAR(40) NOT NULL,
                is_synthetic BOOLEAN NOT NULL DEFAULT 0,
                content_hash VARCHAR(64) NOT NULL,
                content JSON NOT NULL,
                provenance JSON NOT NULL DEFAULT '{}',
                node_metadata JSON NOT NULL DEFAULT '{}',
                reveal_policy_key VARCHAR(80) NOT NULL DEFAULT 'generic',
                storage_adapter VARCHAR(80) NOT NULL DEFAULT 'generic_json',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_node_output_snapshot_system_node_hash
                    UNIQUE (agent_system_id, node_id, content_hash)
            )
            """
        )
    )
    for statement in (
        "CREATE INDEX IF NOT EXISTS ix_node_output_snapshots_agent_system_id "
        "ON node_output_snapshots (agent_system_id)",
        "CREATE INDEX IF NOT EXISTS ix_node_output_snapshots_source_trace_id "
        "ON node_output_snapshots (source_trace_id)",
        "CREATE INDEX IF NOT EXISTS ix_node_output_snapshots_node_id "
        "ON node_output_snapshots (node_id)",
        "CREATE INDEX IF NOT EXISTS ix_node_output_snapshots_output_key "
        "ON node_output_snapshots (output_key)",
        "CREATE INDEX IF NOT EXISTS ix_node_output_snapshots_snapshot_kind "
        "ON node_output_snapshots (snapshot_kind)",
        "CREATE INDEX IF NOT EXISTS ix_node_output_snapshots_observed_at "
        "ON node_output_snapshots (observed_at)",
        "CREATE INDEX IF NOT EXISTS ix_node_output_snapshots_source "
        "ON node_output_snapshots (source)",
        "CREATE INDEX IF NOT EXISTS ix_node_output_snapshots_provider "
        "ON node_output_snapshots (provider)",
        "CREATE INDEX IF NOT EXISTS ix_node_output_snapshots_capture_mode "
        "ON node_output_snapshots (capture_mode)",
    ):
        connection.execute(text(statement))

    portfolio_columns = (
        {item["name"] for item in inspect(connection).get_columns("portfolio_snapshots")}
        if _table_exists(connection, "portfolio_snapshots")
        else set()
    )
    if {
        "id",
        "agent_system_id",
        "source_trace_id",
        "schema_version",
        "label",
        "as_of",
        "source_kind",
        "is_synthetic",
        "content_hash",
        "document",
        "created_at",
    } <= portfolio_columns:
        connection.execute(
            text(
                """
                INSERT OR IGNORE INTO node_output_snapshots (
                    id, agent_system_id, source_trace_id, node_id, node_kind,
                    output_key, snapshot_kind, schema_version, label, observed_at,
                    captured_at, source, provider, capture_mode, is_synthetic,
                    content_hash, content, provenance, node_metadata,
                    reveal_policy_key, storage_adapter, created_at
                )
                SELECT id, agent_system_id, source_trace_id,
                    'persist_portfolio_snapshot', 'deterministic',
                    'portfolio_state', 'state', schema_version, label, as_of,
                    created_at, source_kind, NULL,
                    CASE WHEN source_trace_id IS NULL THEN 'seeded' ELSE 'computed' END,
                    is_synthetic, content_hash, document,
                    json_object('source_kind', source_kind, 'source_trace_id', source_trace_id,
                        'as_of', as_of),
                    json_object('position_count',
                        COALESCE(json_array_length(json_extract(document, '$.positions')), 0),
                        'output_contract', 'indexed_portfolio_state'),
                    'portfolio_state', 'portfolio_snapshot', created_at
                FROM portfolio_snapshots
                """
            )
        )

    runtime_columns = (
        {item["name"] for item in inspect(connection).get_columns("runtime_input_snapshots")}
        if _table_exists(connection, "runtime_input_snapshots")
        else set()
    )
    if {
        "id",
        "agent_system_id",
        "source_trace_id",
        "node_id",
        "source_key",
        "schema_version",
        "label",
        "observed_at",
        "fetched_at",
        "provider",
        "source_kind",
        "is_synthetic",
        "content_hash",
        "payload",
        "provenance",
        "created_at",
    } <= runtime_columns:
        connection.execute(
            text(
                """
                INSERT OR IGNORE INTO node_output_snapshots (
                    id, agent_system_id, source_trace_id, node_id, node_kind,
                    output_key, snapshot_kind, schema_version, label, observed_at,
                    captured_at, source, provider, capture_mode, is_synthetic,
                    content_hash, content, provenance, node_metadata,
                    reveal_policy_key, storage_adapter, created_at
                )
                SELECT id, agent_system_id, source_trace_id, node_id, 'external_input',
                    source_key, 'external_observation', schema_version, label, observed_at,
                    fetched_at, source_key, provider,
                    CASE
                        WHEN source_trace_id IS NULL OR source_kind = 'seed_fixture'
                            THEN 'seeded'
                        ELSE 'live'
                    END,
                    is_synthetic, content_hash, payload, provenance,
                    json_object('output_contract', source_key),
                    'external_observation', 'runtime_input_snapshot', created_at
                FROM runtime_input_snapshots
                """
            )
        )


def _apply_version_eight(connection) -> None:
    for trigger in (
        "prevent_portfolio_snapshot_update",
        "prevent_node_output_snapshot_update",
    ):
        connection.execute(text(f"DROP TRIGGER IF EXISTS {trigger}"))
    if _table_exists(connection, "portfolio_snapshots"):
        _add_column_if_missing(
            connection,
            "portfolio_snapshots",
            "resource_identity",
            "VARCHAR(120) NOT NULL DEFAULT 'default'",
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_portfolio_snapshots_resource_identity "
                "ON portfolio_snapshots (resource_identity)"
            )
        )
        portfolio_columns = {
            item["name"] for item in inspect(connection).get_columns("portfolio_snapshots")
        }
        trace_columns = (
            {item["name"] for item in inspect(connection).get_columns("traces")}
            if _table_exists(connection, "traces")
            else set()
        )
        if "source_trace_id" not in portfolio_columns:
            connection.execute(
                text(
                    """
                    UPDATE portfolio_snapshots
                    SET resource_identity = id
                    WHERE resource_identity IS NULL OR resource_identity = ''
                        OR resource_identity = 'default'
                    """
                )
            )
        elif "request_input" not in trace_columns:
            connection.execute(
                text(
                    """
                    UPDATE portfolio_snapshots
                    SET resource_identity = CASE
                        WHEN source_trace_id IS NULL THEN id
                        ELSE 'default'
                    END
                    WHERE resource_identity IS NULL OR resource_identity = ''
                        OR resource_identity = 'default'
                    """
                )
            )
        else:
            connection.execute(
                text(
                    """
                    UPDATE portfolio_snapshots
                    SET resource_identity = CASE
                        WHEN source_trace_id IS NULL THEN id
                        ELSE COALESCE(
                            (
                                SELECT NULLIF(
                                    json_extract(traces.request_input, '$.portfolio_identity'),
                                    ''
                                )
                                FROM traces
                                WHERE traces.id = portfolio_snapshots.source_trace_id
                            ),
                            'default'
                        )
                    END
                    WHERE resource_identity IS NULL OR resource_identity = ''
                        OR resource_identity = 'default'
                    """
                )
            )
    if _table_exists(connection, "node_output_snapshots"):
        _add_column_if_missing(
            connection,
            "node_output_snapshots",
            "resource_identity",
            "VARCHAR(120)",
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_node_output_snapshots_resource_identity "
                "ON node_output_snapshots (resource_identity)"
            )
        )
        node_columns = {
            item["name"] for item in inspect(connection).get_columns("node_output_snapshots")
        }
        if "storage_adapter" in node_columns:
            connection.execute(
                text(
                    """
                    UPDATE node_output_snapshots
                    SET resource_identity = COALESCE(
                        (
                            SELECT portfolio_snapshots.resource_identity
                            FROM portfolio_snapshots
                            WHERE portfolio_snapshots.id = node_output_snapshots.id
                        ),
                        id
                    )
                    WHERE storage_adapter = 'portfolio_snapshot'
                        AND (resource_identity IS NULL OR resource_identity = '')
                    """
                )
            )
    if _table_exists(connection, "dataset_items"):
        _add_column_if_missing(
            connection,
            "dataset_items",
            "node_resource_selections",
            "JSON NOT NULL DEFAULT '{}'",
        )
    if _table_exists(connection, "traces"):
        _add_column_if_missing(
            connection,
            "traces",
            "node_resource_selections",
            "JSON NOT NULL DEFAULT '{}'",
        )
        _add_column_if_missing(
            connection,
            "traces",
            "capture_node_outputs",
            "BOOLEAN NOT NULL DEFAULT 0",
        )


def _apply_version_nine(connection) -> None:
    """Align legacy catalog metadata with each authoritative adapter row."""
    if not _table_exists(connection, "node_output_snapshots"):
        return
    node_columns = {
        item["name"] for item in inspect(connection).get_columns("node_output_snapshots")
    }
    if (
        not {
            "id",
            "resource_identity",
            "storage_adapter",
            "node_metadata",
        }
        <= node_columns
    ):
        return

    connection.execute(text("DROP TRIGGER IF EXISTS prevent_node_output_snapshot_update"))
    if _table_exists(connection, "portfolio_snapshots"):
        portfolio_columns = {
            item["name"] for item in inspect(connection).get_columns("portfolio_snapshots")
        }
        if {"id", "resource_identity", "document"} <= portfolio_columns:
            connection.execute(
                text(
                    """
                    UPDATE node_output_snapshots
                    SET resource_identity = (
                            SELECT portfolio_snapshots.resource_identity
                            FROM portfolio_snapshots
                            WHERE portfolio_snapshots.id = node_output_snapshots.id
                        ),
                        node_metadata = json_object(
                            'position_count', COALESCE(
                                json_array_length(json_extract((
                                    SELECT portfolio_snapshots.document
                                    FROM portfolio_snapshots
                                    WHERE portfolio_snapshots.id = node_output_snapshots.id
                                ), '$.positions')),
                                0
                            ),
                            'output_contract', 'indexed_portfolio_state',
                            'resource_identity', (
                                SELECT portfolio_snapshots.resource_identity
                                FROM portfolio_snapshots
                                WHERE portfolio_snapshots.id = node_output_snapshots.id
                            )
                        )
                    WHERE storage_adapter = 'portfolio_snapshot'
                        AND EXISTS (
                            SELECT 1
                            FROM portfolio_snapshots
                            WHERE portfolio_snapshots.id = node_output_snapshots.id
                        )
                    """
                )
            )

    if _table_exists(connection, "runtime_input_snapshots"):
        runtime_columns = {
            item["name"] for item in inspect(connection).get_columns("runtime_input_snapshots")
        }
        if {"id", "source_key", "provenance"} <= runtime_columns:
            metadata_expression = "json_object('output_contract', source_key)"
            for key in ("status", "contract_count", "freshness", "greeks", "error_code"):
                metadata_expression = f"""
                    json_patch(
                        {metadata_expression},
                        CASE
                            WHEN json_type(provenance, '$.{key}') IS NOT NULL
                            THEN json_object('{key}', json_extract(provenance, '$.{key}'))
                            ELSE json('{{}}')
                        END
                    )
                """
            connection.execute(
                text(
                    f"""
                    UPDATE node_output_snapshots
                    SET resource_identity = NULL,
                        node_metadata = (
                            SELECT {metadata_expression}
                            FROM runtime_input_snapshots
                            WHERE runtime_input_snapshots.id = node_output_snapshots.id
                        )
                    WHERE storage_adapter = 'runtime_input_snapshot'
                        AND EXISTS (
                            SELECT 1
                            FROM runtime_input_snapshots
                            WHERE runtime_input_snapshots.id = node_output_snapshots.id
                        )
                    """
                )
            )


def _add_column_if_missing(connection, table: str, column: str, definition: str) -> None:
    columns = {item["name"] for item in inspect(connection).get_columns(table)}
    if column not in columns:
        connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}"))


def _table_exists(connection, table: str) -> bool:
    return table in inspect(connection).get_table_names()


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
        CREATE TRIGGER IF NOT EXISTS prevent_portfolio_snapshot_update
        BEFORE UPDATE ON portfolio_snapshots
        BEGIN
            SELECT RAISE(ABORT, 'portfolio_snapshot_immutable');
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS prevent_portfolio_snapshot_delete
        BEFORE DELETE ON portfolio_snapshots
        BEGIN
            SELECT RAISE(ABORT, 'portfolio_snapshot_immutable');
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
        """
        CREATE TRIGGER IF NOT EXISTS prevent_runtime_input_snapshot_update
        BEFORE UPDATE ON runtime_input_snapshots
        BEGIN
            SELECT RAISE(ABORT, 'runtime_input_snapshot_immutable');
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS prevent_runtime_input_snapshot_delete
        BEFORE DELETE ON runtime_input_snapshots
        BEGIN
            SELECT RAISE(ABORT, 'runtime_input_snapshot_immutable');
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS prevent_node_output_snapshot_update
        BEFORE UPDATE ON node_output_snapshots
        BEGIN
            SELECT RAISE(ABORT, 'node_output_snapshot_immutable');
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS prevent_node_output_snapshot_delete
        BEFORE DELETE ON node_output_snapshots
        BEGIN
            SELECT RAISE(ABORT, 'node_output_snapshot_immutable');
        END
        """,
    )
    for statement in statements:
        connection.execute(text(statement))
