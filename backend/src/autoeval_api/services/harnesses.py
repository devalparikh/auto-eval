"""External harness sessions, reviewed datasets, and paired task benchmarks."""

from statistics import mean

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from autoeval_api.harness_schemas import (
    ConnectHarness,
    HarnessCapture,
    HarnessCaptureSummary,
    HarnessReceipt,
    HarnessRun,
    HarnessRunSummary,
    HarnessSuite,
    HarnessTask,
    HarnessTrainingExport,
    HarnessWorkspace,
)
from autoeval_api.models import (
    AgentSystemRecord,
    DatasetItemRecord,
    DatasetRecord,
    DatasetVersionRecord,
    HarnessCaptureRecord,
    HarnessRunRecord,
    HarnessSuiteRecord,
    HarnessTaskRecord,
    utc_now,
)
from autoeval_api.services.harness_data import (
    REQUEST_FIELDS,
    RESPONSE_FIELDS,
    capture_training_example,
    clean_payload,
)
from autoeval_api.services.versioning import hash_json


def system_for(session: Session, key: str) -> AgentSystemRecord:
    system = session.query(AgentSystemRecord).filter_by(key=key).one_or_none()
    if system is None or system.import_metadata.get("runtime") != "external_harness":
        raise LookupError("Connected harness not found")
    return system


def commit(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise ValueError("This identity already exists; reload before retrying") from error


def receipt(record) -> HarnessReceipt:
    return HarnessReceipt(id=record.id, content_hash=record.content_hash)


def connect(session: Session, request: ConnectHarness) -> HarnessWorkspace:
    existing = session.query(AgentSystemRecord).filter_by(key=request.key).one_or_none()
    if existing:
        if existing.import_metadata != {"runtime": "external_harness", "harness": request.harness}:
            raise ValueError("System key is already in use")
        if existing.name != request.name:
            raise ValueError("System key is already connected with a different name")
    else:
        session.add(
            AgentSystemRecord(
                key=request.key,
                name=request.name,
                description="Captured sessions and task benchmarks from an external agent harness.",
                import_metadata={"runtime": "external_harness", "harness": request.harness},
            )
        )
        commit(session)
    return workspace(session, request.key)


def add_task(session: Session, key: str, request: HarnessTask) -> HarnessReceipt:
    system = system_for(session, key)
    document = request.model_dump()
    digest = hash_json(document)
    tasks = session.query(HarnessTaskRecord).filter_by(agent_system_id=system.id).all()
    for task in tasks:
        if task.key == request.key:
            if task.content_hash != digest:
                raise ValueError("Tasks are immutable; use a new key for changed content")
            return receipt(task)
        if (
            task.document["prompt"].strip() == request.prompt.strip()
            and task.document["partition"] != request.partition
        ):
            raise ValueError("The same task cannot appear in training and held-out partitions")
    record = HarnessTaskRecord(
        agent_system_id=system.id, key=request.key, document=document, content_hash=digest
    )
    session.add(record)
    commit(session)
    return receipt(record)


def ingest(session: Session, key: str, request: HarnessCapture) -> HarnessReceipt:
    system = system_for(session, key)
    task = (
        session.query(HarnessTaskRecord)
        .filter_by(
            agent_system_id=system.id,
            key=request.task_key,
        )
        .one_or_none()
    )
    if task is None:
        raise ValueError("Create the task and assign its partition before capturing sessions")
    document = request.model_dump()
    document["request"] = clean_payload(document["request"], REQUEST_FIELDS)
    document["response"] = clean_payload(document["response"], RESPONSE_FIELDS)
    digest = hash_json(document)
    existing = (
        session.query(HarnessCaptureRecord)
        .filter_by(
            agent_system_id=system.id,
            request_id=request.request_id,
        )
        .one_or_none()
    )
    if existing:
        if existing.content_hash != digest:
            raise ValueError("Request ID already exists with different content")
        return receipt(existing)
    context_hash = hash_json(
        {
            field: value
            for field, value in document["request"].items()
            if field
            in {"messages", "input", "instructions", "system", "tools", "previous_response_id"}
        }
    )
    captures = (
        session.query(HarnessCaptureRecord)
        .filter(
            HarnessCaptureRecord.agent_system_id == system.id,
            (HarnessCaptureRecord.session_id == request.session_id)
            | (HarnessCaptureRecord.context_hash == context_hash),
        )
        .all()
    )
    for capture in captures:
        if capture.document["session_id"] == request.session_id and capture.task_id != task.id:
            raise ValueError("One session must belong to one task and partition")
        # Exact contexts cannot leak across partitions, even under another task ID.
        if capture.context_hash == context_hash:
            owner = session.get(HarnessTaskRecord, capture.task_id)
            if owner.document["partition"] != task.document["partition"]:
                raise ValueError("Captured context already belongs to another partition")
    record = HarnessCaptureRecord(
        agent_system_id=system.id,
        task_id=task.id,
        session_id=request.session_id,
        context_hash=context_hash,
        provider_response_id=(
            document["response"].get("id")
            if isinstance(document["response"].get("id"), str)
            else None
        ),
        request_id=request.request_id,
        document=document,
        content_hash=digest,
    )
    session.add(record)
    commit(session)
    return receipt(record)


def capture_for(session: Session, key: str, capture_id: str) -> HarnessCaptureRecord:
    system = system_for(session, key)
    capture = (
        session.query(HarnessCaptureRecord)
        .filter_by(
            id=capture_id,
            agent_system_id=system.id,
        )
        .one_or_none()
    )
    if capture is None:
        raise LookupError("Capture not found")
    return capture


def review(session: Session, key: str, capture_id: str, decision: str) -> HarnessReceipt:
    capture = capture_for(session, key, capture_id)
    task = session.get(HarnessTaskRecord, capture.task_id)
    if decision == "approved":
        if task.document["partition"] == "benchmark":
            raise ValueError("Benchmark captures are held out and cannot become training examples")
        try:
            capture_training_example(session, capture)
        except (KeyError, TypeError, IndexError) as error:
            raise ValueError("Capture lacks a complete supported conversation") from error
    capture.review = decision
    commit(session)
    return receipt(capture)


def export_training(session: Session, key: str) -> HarnessTrainingExport:
    system = system_for(session, key)
    captures = (
        session.query(HarnessCaptureRecord)
        .filter_by(
            agent_system_id=system.id,
            review="approved",
        )
        .order_by(HarnessCaptureRecord.id)
        .limit(10001)
        .all()
    )
    if len(captures) > 10000:
        raise ValueError("Export supports at most 10,000 approved captures")
    groups: dict[str, list[dict]] = {"train": [], "validation": []}
    provenance, seen = [], {}
    for capture in captures:
        task = session.get(HarnessTaskRecord, capture.task_id)
        partition = task.document["partition"]
        if partition not in groups:
            raise ValueError("Benchmark data cannot be exported for training")
        example = capture_training_example(session, capture)
        context_hash = hash_json(
            {"messages": example["messages"][:-1], "tools": example.get("tools", [])}
        )
        if context_hash in seen:
            previous_partition, previous = seen[context_hash]
            if previous_partition != partition or previous != example:
                raise ValueError("Duplicate context crosses partitions or has conflicting targets")
            continue
        seen[context_hash] = (partition, example)
        groups[partition].append(example)
        provenance.append(
            {
                "capture_id": capture.id,
                "capture_hash": capture.content_hash,
                "task_hash": task.content_hash,
                "partition": partition,
                "example": example,
            }
        )
    if not all(groups.values()):
        raise ValueError("Approve at least one training task and one separate validation task")
    digest = hash_json(provenance)
    dataset_key = f"harness-{digest}"
    dataset = session.query(DatasetRecord).filter_by(key=dataset_key).one_or_none()
    if dataset is None:
        dataset = DatasetRecord(
            agent_system_id=system.id,
            key=dataset_key,
            name=f"{system.name} reviewed sessions",
            description="Frozen native conversations, split by task.",
        )
        session.add(dataset)
        session.flush()
        version = DatasetVersionRecord(dataset_id=dataset.id, version=1, status="draft")
        session.add(version)
        session.flush()
        for item in provenance:
            session.add(
                DatasetItemRecord(
                    dataset_version_id=version.id,
                    input={
                        "harness_capture": {k: v for k, v in item.items() if k != "example"},
                        "messages": item["example"]["messages"][:-1],
                        "tools": item["example"].get("tools", []),
                    },
                    expected={"message": item["example"]["messages"][-1]},
                )
            )
        session.flush()
        version.status = "final"
        version.finalized_at = utc_now()
        commit(session)
    else:
        version = session.query(DatasetVersionRecord).filter_by(dataset_id=dataset.id).one()
    return HarnessTrainingExport(dataset_version_id=version.id, content_hash=digest, **groups)


def freeze_suite(session: Session, key: str, request: HarnessSuite) -> HarnessReceipt:
    system = system_for(session, key)
    if len(set(request.task_keys)) != len(request.task_keys):
        raise ValueError("Duplicate benchmark tasks")
    tasks = (
        session.query(HarnessTaskRecord)
        .filter(
            HarnessTaskRecord.agent_system_id == system.id,
            HarnessTaskRecord.key.in_(request.task_keys),
        )
        .all()
    )
    if len(tasks) != len(request.task_keys) or any(
        task.document["partition"] != "benchmark" for task in tasks
    ):
        raise ValueError("A benchmark can contain only this system's held-out benchmark tasks")
    document = {
        "name": request.name,
        "repetitions": request.repetitions,
        "tasks": [task.document for task in sorted(tasks, key=lambda t: t.key)],
    }
    digest = hash_json(document)
    existing = (
        session.query(HarnessSuiteRecord)
        .filter_by(
            agent_system_id=system.id,
            content_hash=digest,
        )
        .one_or_none()
    )
    if existing:
        return receipt(existing)
    record = HarnessSuiteRecord(agent_system_id=system.id, document=document, content_hash=digest)
    session.add(record)
    commit(session)
    return receipt(record)


def submit_run(session: Session, key: str, request: HarnessRun) -> HarnessReceipt:
    system = system_for(session, key)
    suite = (
        session.query(HarnessSuiteRecord)
        .filter_by(
            id=request.suite_id,
            agent_system_id=system.id,
        )
        .one_or_none()
    )
    if suite is None:
        raise LookupError("Benchmark not found")
    expected = {
        (task["key"], repetition)
        for task in suite.document["tasks"]
        for repetition in range(1, suite.document["repetitions"] + 1)
    }
    actual = [(item.task_key, item.repetition) for item in request.results]
    if set(actual) != expected or len(actual) != len(expected):
        raise ValueError(
            "Include every frozen task and repetition exactly once, including failures"
        )
    document = request.model_dump()
    digest = hash_json(document)
    existing = (
        session.query(HarnessRunRecord)
        .filter_by(
            agent_system_id=system.id,
            request_id=request.request_id,
        )
        .one_or_none()
    )
    if existing:
        if existing.content_hash != digest:
            raise ValueError("Run ID already exists with different results")
        return receipt(existing)
    record = HarnessRunRecord(
        agent_system_id=system.id,
        suite_id=suite.id,
        request_id=request.request_id,
        document=document,
        content_hash=digest,
    )
    session.add(record)
    commit(session)
    return receipt(record)


def run_summary(record: HarnessRunRecord) -> HarnessRunSummary:
    document = record.document
    results = document["results"]
    passed = sum(item["status"] == "completed" and item["test_exit_code"] == 0 for item in results)
    return HarnessRunSummary(
        id=record.id,
        suite_id=record.suite_id,
        label=document["label"],
        model=document["model"],
        harness_revision=document["harness_revision"],
        configuration_hash=document["configuration_hash"],
        passed=passed,
        total=len(results),
        pass_rate=passed / len(results),
        failures=len(results) - passed,
        mean_latency_ms=mean(item["latency_ms"] for item in results),
        cost_usd=(
            sum(item["cost_usd"] for item in results)
            if all(item["cost_usd"] is not None for item in results)
            else None
        ),
        content_hash=record.content_hash,
    )


def workspace(session: Session, key: str) -> HarnessWorkspace:
    system = system_for(session, key)
    tasks = session.query(HarnessTaskRecord).filter_by(agent_system_id=system.id).all()
    partitions = {task.id: task.document["partition"] for task in tasks}
    captures = (
        session.query(HarnessCaptureRecord)
        .filter_by(agent_system_id=system.id)
        .order_by(
            HarnessCaptureRecord.created_at.desc(),
        )
        .limit(500)
        .all()
    )
    suites = session.query(HarnessSuiteRecord).filter_by(agent_system_id=system.id).all()
    runs = (
        session.query(HarnessRunRecord)
        .filter_by(agent_system_id=system.id)
        .order_by(
            HarnessRunRecord.created_at,
            HarnessRunRecord.id,
        )
        .all()
    )
    return HarnessWorkspace(
        system_id=system.id,
        key=key,
        name=system.name,
        harness=system.import_metadata["harness"],
        tasks=[HarnessTask.model_validate(task.document) for task in tasks],
        captures=[
            HarnessCaptureSummary(
                id=item.id,
                task_key=item.document["task_key"],
                session_id=item.document["session_id"],
                model=item.document["model"],
                review=item.review,
                partition=partitions[item.task_id],
                content_hash=item.content_hash,
                input_tokens=item.document["input_tokens"],
                output_tokens=item.document["output_tokens"],
            )
            for item in captures
        ],
        suites=[
            {"id": item.id, "content_hash": item.content_hash, **item.document} for item in suites
        ],
        runs=[run_summary(item) for item in runs],
    )


def run_detail(session: Session, key: str, run_id: str) -> HarnessRun:
    system = system_for(session, key)
    record = (
        session.query(HarnessRunRecord)
        .filter_by(
            id=run_id,
            agent_system_id=system.id,
        )
        .one_or_none()
    )
    if record is None:
        raise LookupError("Benchmark run not found")
    return HarnessRun.model_validate(record.document)
