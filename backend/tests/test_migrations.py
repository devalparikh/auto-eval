from sqlalchemy import create_engine, inspect, text

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

    assert prompt_owner == "system"
    assert dataset_owner == "system"
    assert trace_origin == ("evaluation", "run", "item")
    assert "uq_dataset_version_source_trace" in indexes
