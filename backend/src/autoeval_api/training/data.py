"""Deterministic supervised examples from finalized, reviewed datasets."""

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from autoeval_api.models import DatasetItemRecord, DatasetRecord, DatasetVersionRecord
from autoeval_api.schemas import TrainingDataPreview
from autoeval_api.services.versioning import hash_json


@dataclass
class TrainingData:
    agent_system_id: str
    dataset_hash: str
    train: list[dict[str, Any]]
    validation: list[dict[str, Any]]
    duplicate_count: int

    def preview(self) -> TrainingDataPreview:
        return TrainingDataPreview(
            dataset_hash=self.dataset_hash,
            train_count=len(self.train),
            validation_count=len(self.validation),
            duplicate_count=self.duplicate_count,
            sample=self.train[0]["messages"],
        )


def prepare_training_data(session: Session, version_id: str, system_prompt: str) -> TrainingData:
    version = session.get(DatasetVersionRecord, version_id)
    if version is None:
        raise LookupError("Dataset version not found")
    if version.status != "final":
        raise ValueError("Fine-tuning requires a finalized dataset version")
    dataset = session.get(DatasetRecord, version.dataset_id)
    if dataset is None:
        raise LookupError("Dataset not found")
    items = (
        session.query(DatasetItemRecord)
        .filter_by(dataset_version_id=version_id)
        .order_by(DatasetItemRecord.id)
        .limit(10_001)
        .all()
    )
    if len(items) > 10_000:
        raise ValueError("Local training supports at most 10,000 examples")
    examples: dict[str, dict[str, Any]] = {}
    provenance = []
    total_bytes = 0
    for item in items:
        if not item.input or not item.expected:
            raise ValueError("Every example needs a nonempty input and reviewed expected output")
        # Scoring labels are used explicitly, never an unreviewed trace prediction.
        example = {
            "messages": [
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": json.dumps(item.input, sort_keys=True, ensure_ascii=False),
                },
                {
                    "role": "assistant",
                    "content": json.dumps(item.expected, sort_keys=True, ensure_ascii=False),
                },
            ]
        }
        total_bytes += len(json.dumps(example).encode())
        if total_bytes > 20_000_000:
            raise ValueError("Training examples exceed the 20 MB local export limit")
        input_hash = hash_json(item.input)
        if input_hash in examples and examples[input_hash] != example:
            raise ValueError(
                "Identical inputs have conflicting expected outputs; revise the dataset"
            )
        examples[input_hash] = example
        provenance.append(
            {
                "id": item.id,
                "input": item.input,
                "expected": item.expected,
                "source_trace_id": item.source_trace_id,
                "runtime_input_snapshot_ids": item.runtime_input_snapshot_ids,
                "node_resource_selections": item.node_resource_selections,
            }
        )
    if len(examples) < 2:
        raise ValueError(
            "Fine-tuning needs at least two distinct inputs for training and validation"
        )
    # Hash ordering is stable and keeps duplicate inputs out of both splits.
    rows = [examples[key] for key in sorted(examples)]
    validation_count = max(1, len(rows) // 10)
    return TrainingData(
        agent_system_id=dataset.agent_system_id,
        dataset_hash=hash_json(provenance),
        train=rows[validation_count:],
        validation=rows[:validation_count],
        duplicate_count=len(items) - len(rows),
    )
