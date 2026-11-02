import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.exc import IntegrityError

from autoeval_api.db import Base, build_session_factory
from autoeval_api.migrations import MIGRATION_VERSION, apply_migrations
from autoeval_api.models import (
    AgentSystemVersionRecord,
    DatasetVersionRecord,
    EvalRunRecord,
    PromptVersionRecord,
)
from autoeval_api.services.evaluations import EvaluationService


def draft(client, *, clone=True):
    dataset = client.get("/api/catalog").json()["datasets"][0]
    source = next(version for version in dataset["versions"] if version["status"] == "final")
    response = client.post(
        f"/api/datasets/{dataset['id']}/versions",
        json={"clone_from_version_id": source["id"] if clone else None},
    )
    assert response.status_code == 201
    return response.json()


def request_for(version):
    return {
        "dataset_version_id": version["id"],
        "model_ids": ["mock/incident-specialist"],
        "finalize_dataset": True,
        "expected_dataset_revision": version["content_revision"],
        "request_id": str(uuid4()),
        "run_in_background": False,
    }


def assert_still_draft(client, version):
    current = client.get(f"/api/dataset-versions/{version['id']}").json()
    assert current["status"] == "draft"
    assert current["finalized_at"] is None
    assert client.get(f"/api/eval-runs?dataset_version_id={version['id']}").json() == []


def test_finalize_and_run_is_explicit_and_retry_is_idempotent(client):
    version = draft(client)
    payload = request_for(version)
    refused = client.post("/api/eval-runs", json={**payload, "finalize_dataset": False})
    assert refused.status_code == 400
    assert_still_draft(client, version)

    first = client.post("/api/eval-runs", json=payload)
    assert first.status_code == 201, first.text
    assert first.json()["status"] == "complete"
    assert first.json()["dataset_version_id"] == version["id"]
    finalized = client.get(f"/api/dataset-versions/{version['id']}").json()
    assert finalized["status"] == "final"
    assert finalized["content_revision"] == version["content_revision"]
    second = client.post("/api/eval-runs", json=payload)
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    assert len(client.get(f"/api/eval-runs?dataset_version_id={version['id']}").json()) == 1
    assert (
        client.post(
            f"/api/dataset-versions/{version['id']}/items", json={"input": {}, "expected": {}}
        ).status_code
        == 409
    )

    different = client.post("/api/eval-runs", json={**payload, "model_ids": ["mock/incident-fast"]})
    assert different.status_code == 409


@pytest.mark.parametrize("change", ["edit", "add", "binding"])
def test_stale_content_requires_review_even_when_count_is_unchanged(
    client, session_factory, change
):
    version = draft(client)
    item = version["items"][0]
    if change == "edit":
        response = client.put(
            f"/api/dataset-items/{item['id']}",
            json={"expected": {**item["expected"], "severity": "changed"}},
        )
        assert response.status_code == 200, response.text
    elif change == "add":
        assert (
            client.post(
                f"/api/dataset-versions/{version['id']}/items",
                json={"input": {"text": "Another example"}, "expected": {}},
            ).status_code
            == 201
        )
    else:
        from autoeval_api.models import DatasetItemRecord

        with session_factory() as session:
            record = session.get(DatasetItemRecord, item["id"])
            record.runtime_input_snapshot_ids = {"other": "changed-binding"}
            session.commit()
    response = client.post("/api/eval-runs", json=request_for(version))
    assert response.status_code == 409, response.text
    assert "changed since" in response.json()["detail"]
    assert_still_draft(client, version)


@pytest.mark.parametrize("invalid", ["empty", "model", "revision", "locked_inputs"])
def test_validation_failure_does_not_freeze_dataset(client, monkeypatch, invalid):
    version = draft(client, clone=invalid != "empty")
    payload = request_for(version)
    if invalid == "model":
        payload["model_ids"] = ["mock/does-not-exist"]
    elif invalid == "revision":
        del payload["expected_dataset_revision"]
    elif invalid == "locked_inputs":

        def missing(*args):
            raise RuntimeError("Missing locked runtime-input snapshots")

        monkeypatch.setattr(
            client.app.state.evaluation_service, "_require_locked_runtime_inputs", missing
        )
    response = client.post("/api/eval-runs", json=payload)
    assert response.status_code in (400, 409), response.text
    assert_still_draft(client, version)


def test_database_failure_rolls_back_finalization_and_run(client, session_factory):
    version = draft(client)

    def reject_insert(*args):
        raise RuntimeError("Could not persist run")

    event.listen(EvalRunRecord, "before_insert", reject_insert)
    try:
        response = client.post("/api/eval-runs", json=request_for(version))
        assert response.status_code == 400
    finally:
        event.remove(EvalRunRecord, "before_insert", reject_insert)
    assert_still_draft(client, version)
    with session_factory() as session:
        assert session.get(DatasetVersionRecord, version["id"]).status == "draft"


def test_execution_failure_keeps_dataset_finalized(client, monkeypatch):
    version = draft(client)

    def fail_execution(*args):
        raise RuntimeError("Provider unavailable")

    monkeypatch.setattr(client.app.state.evaluation_service, "_load_context", fail_execution)
    response = client.post("/api/eval-runs", json=request_for(version))
    assert response.status_code == 201
    assert response.json()["status"] == "failed"
    assert client.get(f"/api/dataset-versions/{version['id']}").json()["status"] == "final"


def test_concurrent_retries_create_exactly_one_run(client, session_factory, tmp_path):
    version = draft(client)
    database = tmp_path / "concurrent.db"
    source = session_factory.kw["bind"].raw_connection()
    with sqlite3.connect(database) as target:
        source.driver_connection.backup(target)
    source.close()
    engine = create_engine(f"sqlite:///{database}")
    factory = build_session_factory(engine)
    service = EvaluationService(factory, client.app.state.evaluation_service.runner)
    barrier = Barrier(2)
    request_id = str(uuid4())

    def start():
        with factory() as session:
            selected = session.get(DatasetVersionRecord, version["id"])
            graph = session.query(AgentSystemVersionRecord).first()
            prompt = session.query(PromptVersionRecord).first()
            barrier.wait(timeout=5)
            return service.create_run(
                session,
                selected,
                graph,
                prompt,
                ["mock/incident-specialist"],
                finalize_dataset=True,
                expected_dataset_revision=version["content_revision"],
                request_id=request_id,
            ).id

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(start)
            second = executor.submit(start)
            assert first.result(timeout=10) == second.result(timeout=10)
        with factory() as session:
            assert session.query(EvalRunRecord).count() == 1
            assert session.get(DatasetVersionRecord, version["id"]).status == "final"
    finally:
        engine.dispose()


def test_retry_migration_preserves_existing_runs_and_enforces_uniqueness(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'retry.db'}")
    Base.metadata.create_all(
        engine, tables=[table for table in Base.metadata.sorted_tables if table.name != "eval_runs"]
    )
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY)"))
        for version in range(1, MIGRATION_VERSION):
            connection.execute(text("INSERT INTO schema_migrations VALUES (:v)"), {"v": version})
        connection.execute(text("CREATE TABLE eval_runs (id TEXT PRIMARY KEY)"))
        connection.execute(text("INSERT INTO eval_runs VALUES ('existing')"))
    apply_migrations(engine)
    apply_migrations(engine)
    with engine.begin() as connection:
        assert connection.execute(
            text("SELECT id, request_id, request_hash FROM eval_runs")
        ).one() == (
            "existing",
            None,
            None,
        )
        assert any(index["unique"] for index in inspect(connection).get_indexes("eval_runs"))
        connection.execute(text("INSERT INTO eval_runs (id, request_id) VALUES ('first', 'retry')"))
        with pytest.raises(IntegrityError):
            connection.execute(
                text("INSERT INTO eval_runs (id, request_id) VALUES ('second', 'retry')")
            )
    engine.dispose()
