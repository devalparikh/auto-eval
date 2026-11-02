import asyncio
import json
import zipfile
from collections.abc import Callable
from pathlib import Path
from tempfile import NamedTemporaryFile
from uuid import UUID

from sqlalchemy.orm import Session

from autoeval_api.config import Settings
from autoeval_api.models import CustomModelRecord, utc_now
from autoeval_api.schemas import (
    CreateCustomModelRequest,
    CustomModelResponse,
    UpdateCustomModelRequest,
)
from autoeval_api.services.versioning import hash_json
from autoeval_api.training.data import prepare_training_data
from autoeval_api.training.local import LocalTrainer

ACTIVE_STATUSES = {"queued", "running"}


class TrainingConflict(ValueError):
    pass


class CustomModelService:
    def __init__(
        self,
        session_factory: Callable[[], Session],
        settings: Settings,
        trainer: LocalTrainer | None = None,
    ):
        self.session_factory = session_factory
        self.settings = settings
        self.trainer = trainer or LocalTrainer()
        self._admission = asyncio.Lock()
        self._tasks: dict[str, asyncio.Task] = {}

    def get(self, session: Session, model_id: str) -> CustomModelRecord:
        record = session.get(CustomModelRecord, model_id)
        if record is None:
            raise LookupError("Custom model not found")
        return record

    def list_models(self, session: Session) -> list[CustomModelResponse]:
        records = (
            session.query(CustomModelRecord).order_by(CustomModelRecord.created_at.desc()).all()
        )
        return [CustomModelResponse.model_validate(record) for record in records]

    def create(self, session: Session, request: CreateCustomModelRequest) -> CustomModelRecord:
        data = prepare_training_data(session, request.dataset_version_id, request.system_prompt)
        if request.training_config.batch_size > min(len(data.train), len(data.validation)):
            raise ValueError("Batch size cannot exceed the training or validation example count")
        recipe = request.model_dump(exclude={"name"})
        record = CustomModelRecord(
            name=request.name,
            agent_system_id=data.agent_system_id,
            dataset_version_id=request.dataset_version_id,
            base_model=request.base_model,
            base_revision=request.base_revision,
            system_prompt=request.system_prompt,
            training_config=request.training_config.model_dump(),
            dataset_hash=data.dataset_hash,
            recipe_hash=hash_json({**recipe, "dataset_hash": data.dataset_hash}),
            train_count=len(data.train),
            validation_count=len(data.validation),
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return record

    def update_metadata(
        self,
        session: Session,
        model_id: str,
        request: UpdateCustomModelRequest,
    ) -> CustomModelRecord:
        record = self.get(session, model_id)
        query = session.query(CustomModelRecord).filter_by(id=model_id)
        if request.archived:
            query = query.filter(CustomModelRecord.status.not_in(ACTIVE_STATUSES))
        if query.update({"name": request.name, "archived": request.archived}) != 1:
            session.rollback()
            raise TrainingConflict("Cancel training before archiving this model")
        session.commit()
        session.refresh(record)
        return record

    def directory(self, model_id: str) -> Path:
        # IDs, paths, and filenames cannot be supplied by the training request.
        identifier = str(UUID(model_id))
        root = self.settings.training_artifacts_dir.resolve()
        directory = root / identifier
        if directory.resolve().parent != root or directory.is_symlink():
            raise ValueError("Invalid training artifact directory")
        return directory

    async def start(self, model_id: str) -> CustomModelResponse:
        async with self._admission:
            with self.session_factory() as session:
                record = self.get(session, model_id)
                if record.status != "draft" or record.archived:
                    raise TrainingConflict(
                        "Only an unarchived draft can start. Create a new model to retrain."
                    )
                if (
                    self._tasks
                    or session.query(CustomModelRecord)
                    .filter(CustomModelRecord.status.in_(ACTIVE_STATUSES))
                    .first()
                ):
                    raise TrainingConflict(
                        "Another model is training. Wait for it to finish or cancel it."
                    )
                runtime = await asyncio.to_thread(
                    self.trainer.runtime, production=self.settings.production
                )
                if not runtime.available:
                    raise TrainingConflict(runtime.reason)
                data = prepare_training_data(
                    session, record.dataset_version_id, record.system_prompt
                )
                if data.dataset_hash != record.dataset_hash:
                    raise TrainingConflict(
                        "The pinned dataset content has changed; training was refused"
                    )
                recipe = {
                    "dataset_version_id": record.dataset_version_id,
                    "base_model": record.base_model,
                    "base_revision": record.base_revision,
                    "system_prompt": record.system_prompt,
                    "training_config": record.training_config,
                    "dataset_hash": record.dataset_hash,
                }
                if hash_json(recipe) != record.recipe_hash:
                    raise TrainingConflict(
                        "The pinned training recipe has changed; training was refused"
                    )
                directory = self.directory(model_id)
                directory.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                # Failed preparation remains a draft and can safely replace these exports.
                directory.mkdir(mode=0o700, exist_ok=True)
                for name, rows in (("train", data.train), ("valid", data.validation)):
                    (directory / f"{name}.jsonl").write_text(
                        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
                    )
                (directory / "manifest.json").write_text(
                    json.dumps(
                        {
                            **recipe,
                            "recipe_hash": record.recipe_hash,
                            "executor": record.executor,
                            "train_count": record.train_count,
                            "validation_count": record.validation_count,
                            "format": "input-expected-json-v1",
                            "mlx_lm_version": "0.30.7",
                        },
                        indent=2,
                    )
                )
                claimed = (
                    session.query(CustomModelRecord)
                    .filter_by(id=model_id, status="draft", archived=False)
                    .update({"status": "queued"})
                )
                if claimed != 1:
                    session.rollback()
                    raise TrainingConflict(
                        "This model changed while preparing training. Refresh and retry."
                    )
                session.commit()
                session.refresh(record)
                response = CustomModelResponse.model_validate(record)
            task = asyncio.create_task(self._run(model_id, directory))
            self._tasks[model_id] = task
            task.add_done_callback(lambda _: self._tasks.pop(model_id, None))
            return response

    async def _run(self, model_id: str, directory: Path) -> None:
        def update(**values):
            with self.session_factory() as session:
                record = self.get(session, model_id)
                for key, value in values.items():
                    setattr(record, key, value)
                session.commit()

        try:
            update(status="running", started_at=utc_now())
            revision = await self.trainer.run(
                directory,
                self.settings.training_timeout_seconds,
                lambda tail, metrics: update(log_tail=tail, **metrics),
            )
            update(status="complete", resolved_revision=revision, finished_at=utc_now())
        except asyncio.CancelledError:
            update(status="cancelled", finished_at=utc_now())
            raise
        except Exception as error:
            message = (
                "Training reached the configured time limit."
                if isinstance(error, TimeoutError)
                else "Training failed. Check the log, model access, and available disk space."
            )
            update(status="failed", error=message, finished_at=utc_now())

    async def cancel(self, model_id: str) -> CustomModelResponse:
        async with self._admission:
            with self.session_factory() as session:
                record = self.get(session, model_id)
                if record.status not in ACTIVE_STATUSES:
                    raise TrainingConflict("This model has no active training job")
            task = self._tasks.get(model_id)
            if task:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            # A task cancelled before its coroutine begins cannot update its row.
            with self.session_factory() as session:
                record = self.get(session, model_id)
                if record.status in ACTIVE_STATUSES:
                    record.status, record.finished_at = "cancelled", utc_now()
                    session.commit()
                return CustomModelResponse.model_validate(record)

    def recover_interrupted(self) -> None:
        with self.session_factory() as session:
            for record in session.query(CustomModelRecord).filter(
                CustomModelRecord.status.in_(ACTIVE_STATUSES)
            ):
                record.status = "failed"
                record.error = "The server stopped during training. Create a new model to retry."
                record.finished_at = utc_now()
            session.commit()

    async def shutdown(self) -> None:
        for model_id in list(self._tasks):
            await self.cancel(model_id)

    def artifact_archive(self, session: Session, model_id: str) -> Path:
        record = self.get(session, model_id)
        if record.status != "complete":
            raise TrainingConflict("Adapter downloads are available after training completes")
        directory = self.directory(model_id)
        paths = [
            "adapter/adapters.safetensors",
            "adapter/adapter_config.json",
            "manifest.json",
            "result.json",
        ]
        for name in paths:
            path = directory / name
            if not path.is_file() or not path.resolve().is_relative_to(directory):
                raise LookupError("Saved adapter files are missing")
        archive = directory / "adapter.zip"
        if not archive.exists():
            # Fixed files only: training examples and credentials never enter a download.
            with NamedTemporaryFile(dir=directory, suffix=".zip", delete=False) as handle:
                temporary = Path(handle.name)
            try:
                with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED) as output:
                    for name in paths:
                        output.write(directory / name, arcname=name)
                temporary.replace(archive)
            finally:
                temporary.unlink(missing_ok=True)
        return archive
