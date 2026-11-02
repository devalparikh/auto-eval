import asyncio
import io
import json
import os
import sys
import zipfile

import pytest
from sqlalchemy import text

from autoeval_api.config import Settings
from autoeval_api.models import CustomModelRecord, DatasetItemRecord, DatasetVersionRecord
from autoeval_api.schemas import CreateCustomModelRequest, TrainingRuntime
from autoeval_api.services.custom_models import CustomModelService, TrainingConflict
from autoeval_api.training.data import prepare_training_data
from autoeval_api.training.local import BASE_MODELS, LocalTrainer, worker_environment


def request_for(session_factory, **values):
    with session_factory() as session:
        version = session.query(DatasetVersionRecord).filter_by(status="final").first()
        return CreateCustomModelRequest(
            name="My classifier",
            dataset_version_id=version.id,
            base_model=BASE_MODELS[0].id,
            **values,
        )


class ControlledTrainer(LocalTrainer):
    def __init__(self, *, available=True, fail=False):
        self.available = available
        self.fail = fail
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.cancelled = False

    def runtime(self, **_):
        return TrainingRuntime(
            available=self.available, reason="Test runtime", base_models=BASE_MODELS
        )

    async def run(self, directory, timeout, progress):
        self.started.set()
        progress("Base model loaded\n", {"resolved_revision": "a" * 40})
        try:
            await self.release.wait()
        except asyncio.CancelledError:
            self.cancelled = True
            raise
        if self.fail:
            raise RuntimeError("a secret must not leak")
        progress("Training complete\n", {"completed_steps": 100, "training_loss": 0.5})
        (directory / "adapter").mkdir()
        (directory / "adapter" / "adapters.safetensors").write_bytes(b"test weights")
        (directory / "adapter" / "adapter_config.json").write_text("{}")
        (directory / "result.json").write_text(json.dumps({"revision": "a" * 40}))
        return "a" * 40


def service_for(session_factory, tmp_path, trainer):
    return CustomModelService(
        session_factory,
        Settings(_env_file=None, training_artifacts_dir=tmp_path),
        trainer,
    )


def test_create_preview_and_manage_model_without_training(client, session_factory):
    request = request_for(session_factory).model_dump()
    preview = client.post("/api/custom-models/preview", json=request)
    assert preview.status_code == 200
    data = preview.json()
    assert data["train_count"] > 0 and data["validation_count"] > 0
    assert [message["role"] for message in data["sample"]] == ["system", "user", "assistant"]
    created = client.post("/api/custom-models", json=request)
    assert created.status_code == 201
    model = created.json()
    assert model["status"] == "draft"
    assert model["dataset_hash"] == data["dataset_hash"]
    model_id = model["id"]
    updated = client.put(
        f"/api/custom-models/{model_id}", json={"name": "Renamed", "archived": True}
    )
    assert updated.status_code == 200
    assert updated.json()["recipe_hash"] == model["recipe_hash"]
    assert client.get("/api/custom-models").json()[0]["archived"] is True
    assert client.post(f"/api/custom-models/{model_id}/train").status_code == 409
    assert client.get(f"/api/custom-models/{model_id}/artifacts").status_code == 409
    assert (
        client.put(
            f"/api/custom-models/{model_id}", json={"name": "Restored", "archived": False}
        ).json()["archived"]
        is False
    )
    assert client.get("/api/custom-models/unknown").status_code == 404


def test_api_starts_training_and_serves_finished_adapter(client, session_factory, tmp_path):
    trainer = ControlledTrainer()
    trainer.release.set()
    service = service_for(session_factory, tmp_path, trainer)
    client.app.state.custom_model_service = service
    model = client.post("/api/custom-models", json=request_for(session_factory).model_dump()).json()
    response = client.post(f"/api/custom-models/{model['id']}/train")
    assert response.status_code == 202

    async def finish():
        await asyncio.gather(*list(service._tasks.values()))

    client.portal.call(finish)
    completed = client.get(f"/api/custom-models/{model['id']}").json()
    assert completed["status"] == "complete"
    assert completed["completed_steps"] == 100
    bundle = client.get(f"/api/custom-models/{model['id']}/artifacts")
    assert bundle.status_code == 200
    assert bundle.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(bundle.content)) as archive:
        assert archive.read("adapter/adapters.safetensors") == b"test weights"


@pytest.mark.parametrize(
    "changes",
    [
        {"name": "   "},
        {"base_model": "../../tmp"},
        {"base_model": "https://evil.example/model"},
        {"base_model": "org/model;ls"},
        {"training_config": {"steps": 0}},
        {"training_config": {"learning_rate": 5}},
        {"executor": "cloud"},
    ],
)
def test_invalid_training_requests_are_rejected(client, session_factory, changes):
    body = {**request_for(session_factory).model_dump(), **changes}
    assert client.post("/api/custom-models", json=body).status_code == 422


def test_draft_empty_and_conflicting_datasets_rejected(session_factory):
    with session_factory() as session:
        source = session.query(DatasetVersionRecord).first()
        version = DatasetVersionRecord(dataset_id=source.dataset_id, version=98)
        session.add(version)
        session.commit()
        with pytest.raises(ValueError, match="finalized"):
            prepare_training_data(session, version.id, "JSON")
        session.add_all(
            [
                DatasetItemRecord(dataset_version_id=version.id, input={"x": 1}, expected={"y": 1}),
                DatasetItemRecord(dataset_version_id=version.id, input={"x": 1}, expected={"y": 2}),
            ]
        )
        session.commit()
        version.status = "final"
        session.commit()
        with pytest.raises(ValueError, match="conflicting"):
            prepare_training_data(session, version.id, "JSON")


def test_deduplication_and_split_are_deterministic(session_factory):
    with session_factory() as session:
        source = session.query(DatasetVersionRecord).first()
        version = DatasetVersionRecord(dataset_id=source.dataset_id, version=99)
        session.add(version)
        session.flush()
        for x in [1, 1, 2, 3]:
            session.add(
                DatasetItemRecord(dataset_version_id=version.id, input={"x": x}, expected={"y": x})
            )
        session.commit()
        version.status = "final"
        session.commit()
        data = prepare_training_data(session, version.id, "JSON")
        again = prepare_training_data(session, version.id, "JSON")
        assert data == again
        assert data.duplicate_count == 1
        assert len(data.train) == 2 and len(data.validation) == 1
        train_inputs = {row["messages"][1]["content"] for row in data.train}
        val_inputs = {row["messages"][1]["content"] for row in data.validation}
        assert train_inputs.isdisjoint(val_inputs)


async def test_training_admission_completion_and_artifacts(session_factory, tmp_path):
    trainer = ControlledTrainer()
    service = service_for(session_factory, tmp_path, trainer)
    with session_factory() as session:
        first = service.create(session, request_for(session_factory))
        second = service.create(session, request_for(session_factory))
    assert (await service.start(first.id)).status == "queued"
    await trainer.started.wait()
    with pytest.raises(TrainingConflict, match="Another"):
        await service.start(second.id)
    trainer.release.set()
    await service._tasks[first.id]
    with session_factory() as session:
        record = service.get(session, first.id)
        assert record.status == "complete"
        assert record.resolved_revision == "a" * 40
        assert record.training_loss == 0.5
        archive = service.artifact_archive(session, first.id)
        with zipfile.ZipFile(io.BytesIO(archive.read_bytes())) as bundle:
            assert set(bundle.namelist()) == {
                "adapter/adapters.safetensors",
                "adapter/adapter_config.json",
                "manifest.json",
                "result.json",
            }
            assert "train.jsonl" not in bundle.namelist()
    with pytest.raises(TrainingConflict, match="Only"):
        await service.start(first.id)


async def test_cancel_stops_worker_and_allows_next_job(session_factory, tmp_path):
    trainer = ControlledTrainer()
    service = service_for(session_factory, tmp_path, trainer)
    with session_factory() as session:
        first = service.create(session, request_for(session_factory))
        second = service.create(session, request_for(session_factory))
    await service.start(first.id)
    await trainer.started.wait()
    assert (await service.cancel(first.id)).status == "cancelled"
    assert trainer.cancelled
    await service.start(second.id)
    await service.shutdown()
    with session_factory() as session:
        assert service.get(session, second.id).status == "cancelled"


async def test_unavailable_runtime_leaves_draft_and_failure_is_safe(session_factory, tmp_path):
    trainer = ControlledTrainer(available=False, fail=True)
    service = service_for(session_factory, tmp_path, trainer)
    with session_factory() as session:
        model = service.create(session, request_for(session_factory))
    with pytest.raises(TrainingConflict, match="Test runtime"):
        await service.start(model.id)
    trainer.available = True
    trainer.release.set()
    await service.start(model.id)
    await service._tasks[model.id]
    with session_factory() as session:
        record = service.get(session, model.id)
        assert record.status == "failed"
        assert record.resolved_revision == "a" * 40
        assert "secret" not in record.error
        assert record.finished_at is not None


def test_restart_marks_interrupted_jobs_failed(session_factory, tmp_path):
    service = service_for(session_factory, tmp_path, ControlledTrainer())
    with session_factory() as session:
        model = service.create(session, request_for(session_factory))
        model.status = "running"
        session.commit()
    service.recover_interrupted()
    with session_factory() as session:
        record = service.get(session, model.id)
        assert record.status == "failed" and "server stopped" in record.error


async def test_changed_recipe_is_rejected(session_factory, tmp_path):
    service = service_for(session_factory, tmp_path, ControlledTrainer())
    with session_factory() as session:
        model = service.create(session, request_for(session_factory))
        model.base_model = "org/other"
        session.commit()
    with pytest.raises(TrainingConflict, match="recipe has changed"):
        await service.start(model.id)


def test_migration_creates_custom_models_on_existing_database(session_factory):
    from autoeval_api.migrations import apply_migrations

    engine = session_factory.kw["bind"]
    with engine.begin() as connection:
        CustomModelRecord.__table__.drop(connection)
        connection.execute(text("DELETE FROM schema_migrations WHERE version = 11"))
    apply_migrations(engine)
    apply_migrations(engine)
    with session_factory() as session:
        assert session.query(CustomModelRecord).count() == 0


def test_worker_environment_does_not_inherit_provider_secrets(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "secret")
    monkeypatch.setenv("AUTOEVAL_HOSTED_PASSWORD", "secret")
    monkeypatch.setenv("HF_TOKEN", "training-token")
    monkeypatch.setenv("HF_ENDPOINT", "https://untrusted.example")
    environment = worker_environment()
    assert "OPENROUTER_API_KEY" not in environment
    assert "AUTOEVAL_HOSTED_PASSWORD" not in environment
    assert "HF_ENDPOINT" not in environment
    assert environment["HF_TOKEN"] == "training-token"


@pytest.mark.skipif(os.name != "posix", reason="The local MLX executor uses POSIX processes")
async def test_local_executor_terminates_process_on_timeout(monkeypatch, tmp_path):
    original = asyncio.create_subprocess_exec
    processes = []

    async def launch_sleeper(*args, **kwargs):
        process = await original(sys.executable, "-c", "import time; time.sleep(60)", **kwargs)
        processes.append(process)
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", launch_sleeper)
    with pytest.raises(TimeoutError):
        await LocalTrainer().run(tmp_path, 0.05, lambda *_: None)
    assert len(processes) == 1
    assert processes[0].returncode is not None
