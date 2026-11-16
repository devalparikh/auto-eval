from datetime import timedelta

import pytest

from autoeval_api.models import (
    AgentSystemVersionRecord,
    DatasetItemRecord,
    DatasetRecord,
    DatasetVersionRecord,
    EvalItemResultRecord,
    EvalRunRecord,
    NodeOutputSnapshotRecord,
    PromptVersionRecord,
    RunStatus,
    TraceRecord,
    TraceSpanRecord,
    utc_now,
)
from autoeval_api.services.trace_retention import prune_traces


def old_trace(session, *, status=RunStatus.COMPLETE, age_days=45):
    graph = session.query(AgentSystemVersionRecord).first()
    prompt = session.query(PromptVersionRecord).first()
    trace = TraceRecord(
        status=status,
        agent_system_version_id=graph.id,
        prompt_version_id=prompt.id,
        model_id="mock/incident-specialist",
        request_input={"text": "private incident"},
        started_at=utc_now() - timedelta(days=age_days),
        completed_at=utc_now() - timedelta(days=age_days),
    )
    session.add(trace)
    session.flush()
    session.add(
        TraceSpanRecord(trace_id=trace.id, node_id="node", node_kind="llm", sequence=0, input={})
    )
    session.commit()
    return trace


def test_retention_defaults_to_dry_run_and_removes_only_expired_terminal_traces(session_factory):
    with session_factory() as session:
        expired = old_trace(session)
        recent = old_trace(session, age_days=1)
        running = old_trace(session, status=RunStatus.RUNNING)
        assert prune_traces(session, 30) == 1
        assert session.query(TraceRecord).count() == 3
        assert prune_traces(session, 30, apply=True) == 1
        assert session.get(TraceRecord, recent.id) is not None
        assert session.get(TraceRecord, running.id) is not None
        assert session.query(TraceRecord).filter_by(id=expired.id).first() is None
        assert session.query(TraceSpanRecord).filter_by(trace_id=expired.id).count() == 0


@pytest.mark.parametrize("reference", ["dataset", "evaluation", "snapshot"])
def test_retention_preserves_referenced_provenance(session_factory, reference):
    with session_factory() as session:
        trace = old_trace(session)
        dataset = session.query(DatasetRecord).first()
        version = DatasetVersionRecord(dataset_id=dataset.id, version=99, status="draft")
        session.add(version)
        session.flush()
        item = DatasetItemRecord(dataset_version_id=version.id, input={}, expected={})
        session.add(item)
        session.flush()
        if reference == "dataset":
            item.source_trace_id = trace.id
        elif reference == "evaluation":
            run = EvalRunRecord(
                dataset_version_id=version.id,
                agent_system_version_id=trace.agent_system_version_id,
                prompt_version_id=trace.prompt_version_id,
                model_ids=[trace.model_id],
            )
            session.add(run)
            session.flush()
            session.add(
                EvalItemResultRecord(
                    eval_run_id=run.id,
                    dataset_item_id=item.id,
                    model_id=trace.model_id,
                    trace_id=trace.id,
                    expected={},
                    actual={},
                    scores={},
                )
            )
        else:
            session.add(
                NodeOutputSnapshotRecord(
                    id="snapshot",
                    agent_system_id=dataset.agent_system_id,
                    source_trace_id=trace.id,
                    node_id="node",
                    node_kind="deterministic",
                    output_key="output",
                    snapshot_kind="state",
                    schema_version=1,
                    label="Pinned snapshot",
                    observed_at=utc_now(),
                    captured_at=utc_now(),
                    source="local",
                    capture_mode="computed",
                    content_hash="a" * 64,
                    content={},
                )
            )
        session.commit()
        assert prune_traces(session, 30, apply=True) == 0
        assert session.query(TraceRecord).filter_by(id=trace.id).count() == 1
        assert session.query(TraceSpanRecord).filter_by(trace_id=trace.id).count() == 1


def test_sqlite_startup_finishes_the_first_retention_pass_before_requests(session_factory):
    # SQLite can share one connection across threads, so the first pass must not
    # overlap a request there; networked databases run it in the background.
    from fastapi.testclient import TestClient

    from autoeval_api.app import create_application
    from autoeval_api.config import Settings

    with session_factory() as session:
        expired = old_trace(session).id
    app = create_application(
        settings=Settings(
            AUTOEVAL_ENV="test",
            database_url="sqlite://",
            web_origins=["http://localhost:3000"],
            allowed_hosts=["testserver"],
        ),
        engine=session_factory.kw["bind"],
        session_factory=session_factory,
        initialize_database=False,
        seed_on_start=False,
    )
    with TestClient(app), session_factory() as session:
        assert session.get(TraceRecord, expired) is None


def test_a_failed_startup_retention_pass_is_logged_and_the_server_still_starts(
    session_factory, monkeypatch, caplog
):
    from fastapi.testclient import TestClient
    from sqlalchemy.exc import OperationalError

    import autoeval_api.app as app_module
    from autoeval_api.config import Settings

    def locked(*_args, **_kwargs):
        raise OperationalError("DELETE FROM traces", {}, Exception("database is locked"))

    monkeypatch.setattr(app_module, "prune_traces", locked)
    app = app_module.create_application(
        settings=Settings(
            AUTOEVAL_ENV="test",
            database_url="sqlite://",
            web_origins=["http://localhost:3000"],
            allowed_hosts=["testserver"],
        ),
        engine=session_factory.kw["bind"],
        session_factory=session_factory,
        initialize_database=False,
        seed_on_start=False,
    )
    with caplog.at_level("WARNING"), TestClient(app) as client:
        assert client.get("/api/health").status_code == 200
    assert "Trace retention failed; retrying in one hour" in caplog.text
