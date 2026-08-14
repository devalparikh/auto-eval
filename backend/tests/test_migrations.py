import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import DatabaseError

from autoeval_api.migrations import apply_migrations


def test_legacy_database_is_scoped_and_backfilled(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as connection:
        statements = (
            "CREATE TABLE agent_systems (id TEXT PRIMARY KEY, key TEXT)",
            "CREATE TABLE prompts (id TEXT PRIMARY KEY, key TEXT)",
            "CREATE TABLE datasets (id TEXT PRIMARY KEY, key TEXT)",
            "CREATE TABLE traces (id TEXT PRIMARY KEY)",
            "CREATE TABLE dataset_items (id TEXT PRIMARY KEY, dataset_version_id TEXT, "
            "source_trace_id TEXT)",
            "CREATE TABLE eval_item_results (id TEXT PRIMARY KEY, eval_run_id TEXT, "
            "dataset_item_id TEXT, model_id TEXT, trace_id TEXT)",
        )
        for statement in statements:
            connection.execute(text(statement))
        connection.execute(
            text("INSERT INTO agent_systems (id, key) VALUES ('system', 'incident-triage')")
        )
        connection.execute(text("INSERT INTO prompts (id, key) VALUES ('prompt', 'prompt')"))
        connection.execute(text("INSERT INTO datasets (id, key) VALUES ('dataset', 'dataset')"))
        connection.execute(text("INSERT INTO traces (id) VALUES ('trace')"))
        connection.execute(
            text(
                "INSERT INTO eval_item_results "
                "(id, eval_run_id, dataset_item_id, model_id, trace_id) "
                "VALUES ('result', 'run', 'item', 'model', 'trace')"
            )
        )

    apply_migrations(engine)

    with engine.connect() as connection:
        prompt_owner = connection.execute(
            text("SELECT agent_system_id FROM prompts WHERE id = 'prompt'")
        ).scalar_one()
        dataset_owner = connection.execute(
            text("SELECT agent_system_id FROM datasets WHERE id = 'dataset'")
        ).scalar_one()
        trace_origin = connection.execute(
            text(
                "SELECT origin_type, evaluation_run_id, evaluation_dataset_item_id "
                "FROM traces WHERE id = 'trace'"
            )
        ).one()
        indexes = {item["name"] for item in inspect(connection).get_indexes("dataset_items")}
        migration_versions = (
            connection.execute(text("SELECT version FROM schema_migrations ORDER BY version"))
            .scalars()
            .all()
        )
        snapshot_columns = {
            item["name"] for item in inspect(connection).get_columns("portfolio_snapshots")
        }
        runtime_snapshot_columns = {
            item["name"] for item in inspect(connection).get_columns("runtime_input_snapshots")
        }
        node_snapshot_columns = {
            item["name"] for item in inspect(connection).get_columns("node_output_snapshots")
        }
        dataset_item_columns = {
            item["name"] for item in inspect(connection).get_columns("dataset_items")
        }
        trace_columns = {item["name"] for item in inspect(connection).get_columns("traces")}
        table_names = set(inspect(connection).get_table_names())
        runtime_snapshot_mapping = connection.execute(
            text("SELECT runtime_input_snapshot_ids FROM traces WHERE id = 'trace'")
        ).scalar_one()

    assert prompt_owner == "system"
    assert dataset_owner == "system"
    assert trace_origin == ("evaluation", "run", "item")
    assert "uq_dataset_version_source_trace" in indexes
    assert migration_versions == [1, 2, 3, 4, 5, 6, 7, 8, 9]
    assert {
        "id",
        "agent_system_id",
        "resource_identity",
        "content_hash",
        "document",
    } <= snapshot_columns
    assert {
        "id",
        "agent_system_id",
        "node_id",
        "source_key",
        "schema_version",
        "content_hash",
        "payload",
        "provenance",
    } <= runtime_snapshot_columns
    assert "runtime_input_snapshot_ids" in dataset_item_columns
    assert "node_resource_selections" in dataset_item_columns
    assert "runtime_input_snapshot_ids" in trace_columns
    assert "node_snapshot_ids" in trace_columns
    assert "node_resource_selections" in trace_columns
    assert "capture_node_outputs" in trace_columns
    assert {
        "id",
        "agent_system_id",
        "node_id",
        "output_key",
        "snapshot_kind",
        "content_hash",
        "content",
        "node_metadata",
    } <= node_snapshot_columns
    assert runtime_snapshot_mapping == "{}"
    assert "agent_input_samples" in table_names


def test_version_eight_backfills_identity_without_breaking_immutable_triggers(
    tmp_path,
) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'v7-upgrade.db'}")
    with engine.begin() as connection:
        statements = (
            "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at DATETIME)",
            "INSERT INTO schema_migrations (version) VALUES (1), (2), (3), (4), (5), (6), (7)",
            "CREATE TABLE traces (id TEXT PRIMARY KEY, request_input JSON)",
            "CREATE TABLE dataset_versions (id TEXT PRIMARY KEY, status TEXT)",
            "CREATE TABLE dataset_items (id TEXT PRIMARY KEY, dataset_version_id TEXT)",
            "CREATE TABLE runtime_input_snapshots ("
            "id TEXT PRIMARY KEY, agent_system_id TEXT NOT NULL, source_trace_id TEXT, "
            "node_id TEXT NOT NULL, source_key TEXT NOT NULL, schema_version INTEGER NOT NULL, "
            "label TEXT NOT NULL, observed_at DATETIME NOT NULL, fetched_at DATETIME NOT NULL, "
            "provider TEXT NOT NULL, source_kind TEXT NOT NULL, is_synthetic BOOLEAN NOT NULL, "
            "content_hash TEXT NOT NULL, payload JSON NOT NULL, provenance JSON NOT NULL, "
            "created_at DATETIME NOT NULL)",
            "CREATE TABLE portfolio_snapshots ("
            "id TEXT PRIMARY KEY, agent_system_id TEXT NOT NULL, source_trace_id TEXT, "
            "schema_version INTEGER NOT NULL, label TEXT NOT NULL, as_of TEXT NOT NULL, "
            "source_kind TEXT NOT NULL, is_synthetic BOOLEAN NOT NULL, "
            "content_hash TEXT NOT NULL, document JSON NOT NULL, created_at DATETIME NOT NULL)",
            "CREATE TABLE node_output_snapshots ("
            "id TEXT PRIMARY KEY, agent_system_id TEXT NOT NULL, source_trace_id TEXT, "
            "node_id TEXT NOT NULL, node_kind TEXT NOT NULL, output_key TEXT NOT NULL, "
            "snapshot_kind TEXT NOT NULL, schema_version INTEGER NOT NULL, label TEXT NOT NULL, "
            "observed_at DATETIME NOT NULL, captured_at DATETIME NOT NULL, source TEXT NOT NULL, "
            "provider TEXT, capture_mode TEXT NOT NULL, is_synthetic BOOLEAN NOT NULL, "
            "content_hash TEXT NOT NULL, content JSON NOT NULL, provenance JSON NOT NULL, "
            "node_metadata JSON NOT NULL, reveal_policy_key TEXT NOT NULL, "
            "storage_adapter TEXT NOT NULL, created_at DATETIME NOT NULL)",
            "INSERT INTO traces (id, request_input) VALUES "
            "('trace', '{\"portfolio_identity\":\"retirement\"}')",
            "INSERT INTO portfolio_snapshots VALUES "
            "('portfolio-v7', 'system', 'trace', 1, 'Legacy', '2026-08-10T16:00:00Z', "
            "'broker', 0, 'hash', '{\"positions\":[{}]}', CURRENT_TIMESTAMP)",
            "INSERT INTO runtime_input_snapshots VALUES "
            "('runtime-v7', 'system', NULL, 'load_market_data', 'options_chain', 1, "
            "'Legacy options', '2026-08-10T15:00:00Z', '2026-08-10T16:00:00Z', "
            "'fixture', 'seed_fixture', 1, 'runtime-hash', '{\"contracts\":[]}', "
            "json_object('contract_count', 0, 'freshness', "
            "json_object('status', 'fresh')), "
            "CURRENT_TIMESTAMP)",
            "INSERT INTO node_output_snapshots VALUES "
            "('portfolio-v7', 'system', 'trace', 'persist_portfolio_snapshot', "
            "'deterministic', 'portfolio_state', 'state', 1, 'Legacy', "
            "'2026-08-10T16:00:00Z', CURRENT_TIMESTAMP, 'broker', NULL, 'computed', 0, "
            "'hash', '{\"positions\":[{}]}', '{}', '{}', 'portfolio_state', "
            "'portfolio_snapshot', CURRENT_TIMESTAMP)",
            "INSERT INTO node_output_snapshots VALUES "
            "('runtime-v7', 'system', NULL, 'load_market_data', 'external_input', "
            "'options_chain', 'external_observation', 1, 'Legacy options', "
            "'2026-08-10T15:00:00Z', '2026-08-10T16:00:00Z', 'options_chain', "
            "'fixture', 'seeded', 1, 'runtime-hash', '{\"contracts\":[]}', "
            "json_object('contract_count', 0, 'freshness', "
            "json_object('status', 'fresh')), "
            "'{\"output_contract\":\"options_chain\"}', 'external_observation', "
            "'runtime_input_snapshot', CURRENT_TIMESTAMP)",
            "CREATE TRIGGER prevent_portfolio_snapshot_update BEFORE UPDATE "
            "ON portfolio_snapshots BEGIN SELECT RAISE(ABORT, "
            "'portfolio_snapshot_immutable'); END",
            "CREATE TRIGGER prevent_node_output_snapshot_update BEFORE UPDATE "
            "ON node_output_snapshots BEGIN SELECT RAISE(ABORT, "
            "'node_output_snapshot_immutable'); END",
        )
        for statement in statements:
            connection.execute(text(statement))

    apply_migrations(engine)

    with engine.connect() as connection:
        identity = connection.execute(
            text("SELECT resource_identity FROM portfolio_snapshots WHERE id = 'portfolio-v7'")
        ).scalar_one()
        catalog_identity = connection.execute(
            text("SELECT resource_identity FROM node_output_snapshots WHERE id = 'portfolio-v7'")
        ).scalar_one()
        catalog_metadata = connection.execute(
            text("SELECT node_metadata FROM node_output_snapshots WHERE id = 'portfolio-v7'")
        ).scalar_one()
        runtime_catalog_metadata = connection.execute(
            text("SELECT node_metadata FROM node_output_snapshots WHERE id = 'runtime-v7'")
        ).scalar_one()
        versions = (
            connection.execute(text("SELECT version FROM schema_migrations ORDER BY version"))
            .scalars()
            .all()
        )
    assert identity == "retirement"
    assert catalog_identity == "retirement"
    assert catalog_metadata == (
        '{"position_count":1,"output_contract":"indexed_portfolio_state",'
        '"resource_identity":"retirement"}'
    )
    assert runtime_catalog_metadata == (
        '{"output_contract":"options_chain","contract_count":0,"freshness":{"status":"fresh"}}'
    )
    assert versions == list(range(1, 10))

    with (
        pytest.raises(DatabaseError, match="portfolio_snapshot_immutable"),
        engine.begin() as connection,
    ):
        connection.execute(
            text("UPDATE portfolio_snapshots SET label = 'Changed' WHERE id = 'portfolio-v7'")
        )

    with (
        pytest.raises(DatabaseError, match="node_output_snapshot_immutable"),
        engine.begin() as connection,
    ):
        connection.execute(
            text("UPDATE node_output_snapshots SET label = 'Changed' WHERE id = 'portfolio-v7'")
        )


def test_portfolio_snapshots_are_database_immutable(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as connection:
        statements = (
            "CREATE TABLE agent_systems (id TEXT PRIMARY KEY, key TEXT)",
            "CREATE TABLE prompts (id TEXT PRIMARY KEY, key TEXT)",
            "CREATE TABLE datasets (id TEXT PRIMARY KEY, key TEXT)",
            "CREATE TABLE traces (id TEXT PRIMARY KEY)",
            "CREATE TABLE dataset_items (id TEXT PRIMARY KEY, dataset_version_id TEXT, "
            "source_trace_id TEXT)",
            "CREATE TABLE eval_item_results (id TEXT PRIMARY KEY, eval_run_id TEXT, "
            "dataset_item_id TEXT, model_id TEXT, trace_id TEXT)",
        )
        for statement in statements:
            connection.execute(text(statement))
        connection.execute(
            text("INSERT INTO agent_systems (id, key) VALUES ('system', 'portfolio-analyst')")
        )

    apply_migrations(engine)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO portfolio_snapshots "
                "(id, agent_system_id, schema_version, label, as_of, source_kind, "
                "is_synthetic, content_hash, document) VALUES "
                "('snapshot', 'system', 1, 'Synthetic', '2026-08-10T16:00:00Z', "
                "'synthetic', 1, 'hash', '{\"positions\":[{\"symbol\":\"NVDA\"}]}')"
            )
        )

    with (
        pytest.raises(DatabaseError, match="portfolio_snapshot_immutable"),
        engine.begin() as connection,
    ):
        connection.execute(
            text("UPDATE portfolio_snapshots SET label = 'Changed' WHERE id = 'snapshot'")
        )
    with (
        pytest.raises(DatabaseError, match="portfolio_snapshot_immutable"),
        engine.begin() as connection,
    ):
        connection.execute(text("DELETE FROM portfolio_snapshots WHERE id = 'snapshot'"))


def test_prompt_selection_migration_backfills_llm_span_provenance(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'prompt-provenance.db'}")
    with engine.begin() as connection:
        statements = (
            "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at DATETIME)",
            "INSERT INTO schema_migrations (version) VALUES (1), (2)",
            "CREATE TABLE agent_systems (id TEXT PRIMARY KEY)",
            "CREATE TABLE prompt_versions (id TEXT PRIMARY KEY)",
            "CREATE TABLE traces (id TEXT PRIMARY KEY, prompt_version_id TEXT)",
            "CREATE TABLE eval_runs (id TEXT PRIMARY KEY)",
            "CREATE TABLE trace_spans (id TEXT PRIMARY KEY, trace_id TEXT, node_kind TEXT)",
            "CREATE TABLE dataset_versions (id TEXT PRIMARY KEY, status TEXT)",
            "CREATE TABLE dataset_items (id TEXT PRIMARY KEY, dataset_version_id TEXT)",
            "CREATE TABLE portfolio_snapshots (id TEXT PRIMARY KEY)",
            "INSERT INTO prompt_versions (id) VALUES ('prompt-v1')",
            "INSERT INTO traces (id, prompt_version_id) VALUES ('trace', 'prompt-v1')",
            "INSERT INTO trace_spans (id, trace_id, node_kind) "
            "VALUES ('llm-span', 'trace', 'llm'), ('code-span', 'trace', 'deterministic')",
        )
        for statement in statements:
            connection.execute(text(statement))

    apply_migrations(engine)

    with engine.connect() as connection:
        spans = connection.execute(
            text("SELECT id, prompt_version_id FROM trace_spans ORDER BY id")
        ).all()
        trace_mapping = connection.execute(
            text("SELECT prompt_version_ids FROM traces WHERE id = 'trace'")
        ).scalar_one()
        eval_columns = {item["name"] for item in inspect(connection).get_columns("eval_runs")}
        span_columns = {item["name"] for item in inspect(connection).get_columns("trace_spans")}
        dataset_item_columns = {
            item["name"] for item in inspect(connection).get_columns("dataset_items")
        }
        runtime_mapping = connection.execute(
            text("SELECT runtime_input_snapshot_ids FROM traces WHERE id = 'trace'")
        ).scalar_one()

    assert spans == [("code-span", None), ("llm-span", "prompt-v1")]
    assert trace_mapping == "{}"
    assert "prompt_version_ids" in eval_columns
    assert "runtime_input_snapshot_id" in span_columns
    assert "runtime_input_snapshot_ids" in dataset_item_columns
    assert runtime_mapping == "{}"
