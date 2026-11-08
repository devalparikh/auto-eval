import sqlite3
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from threading import Barrier

import pytest
from sqlalchemy import create_engine

from autoeval_api.config import Settings
from autoeval_api.db import build_session_factory
from autoeval_api.models import (
    AgentSystemVersionRecord,
    DatasetStatus,
    DatasetVersionRecord,
    EvalRunRecord,
    PromptVersionRecord,
    TraceRecord,
)
from autoeval_api.services.evaluations import EvaluationLimitExceeded, EvaluationService
from autoeval_api.services.scoring import ScoringRegistry


def payload(client):
    dataset = client.get("/api/catalog").json()["datasets"][0]
    version = next(v for v in dataset["versions"] if v["status"] == "final")
    return {
        "dataset_version_id": version["id"],
        "model_ids": ["mock/incident-specialist"],
        "run_in_background": False,
    }


@pytest.mark.parametrize(
    ("limit", "message"),
    [
        ({"evaluation_max_items": 1}, "item limit"),
        ({"evaluation_max_provider_calls": 1}, "provider-call limit"),
        ({"evaluation_daily_cost_usd": 1}, "daily spend"),
    ],
)
def test_admission_limits_reject_before_creating_work(client, session_factory, limit, message):
    client.app.state.evaluation_service.settings = Settings(_env_file=None, **limit)
    response = client.post("/api/eval-runs", json=payload(client))
    assert response.status_code == 429
    assert message in response.json()["detail"]
    assert response.headers["Retry-After"] == "60"
    with session_factory() as session:
        assert session.query(EvalRunRecord).count() == 0
        assert session.query(TraceRecord).count() == 0


def test_pending_limit_preserves_idempotent_retries(client, monkeypatch):
    service = client.app.state.evaluation_service
    service.settings = Settings(_env_file=None, evaluation_max_pending_runs=1)

    async def leave_queued(_run_id):
        pass

    monkeypatch.setattr(service, "execute", leave_queued)
    request = {**payload(client), "request_id": "retry-1"}
    first = client.post("/api/eval-runs", json=request)
    retry = client.post("/api/eval-runs", json=request)
    rejected = client.post("/api/eval-runs", json={**request, "request_id": "retry-2"})
    assert first.status_code == retry.status_code == 201
    assert first.json()["id"] == retry.json()["id"]
    assert rejected.status_code == 429


def test_spend_limit_stops_before_a_second_provider_call(client, session_factory, monkeypatch):
    service = client.app.state.evaluation_service
    service.settings = Settings(
        _env_file=None, evaluation_max_cost_usd=0.01, evaluation_daily_cost_usd=0.025
    )
    original = service.runner.provider_registry.get_for_model("mock/incident-specialist")
    calls = []

    class CostlyProvider:
        async def complete(self, request):
            calls.append(request)
            return replace(await original.complete(request), cost_usd=0.02)

    monkeypatch.setattr(
        service.runner.provider_registry, "get_for_model", lambda _: CostlyProvider()
    )
    response = client.post("/api/eval-runs", json=payload(client))
    assert response.status_code == 201
    assert response.json()["status"] == "failed"
    assert "spend limit" in response.json()["error"]
    assert len(calls) == 1
    with session_factory() as session:
        assert session.query(TraceRecord).one().cost_usd == 0.02
    assert client.post("/api/eval-runs", json=payload(client)).status_code == 429
    assert len(calls) == 1


def test_admission_is_shared_by_concurrent_service_instances(client, session_factory, tmp_path):
    database = tmp_path / "admission.db"
    source = session_factory.kw["bind"].raw_connection()
    with sqlite3.connect(database) as target:
        source.driver_connection.backup(target)
    source.close()
    engine = create_engine(f"sqlite:///{database}")
    factory = build_session_factory(engine)
    barrier = Barrier(2)

    def start():
        service = EvaluationService(
            factory,
            client.app.state.runner,
            settings=Settings(_env_file=None, evaluation_max_pending_runs=1),
        )
        with factory() as session:
            dataset = (
                session.query(DatasetVersionRecord).filter_by(status=DatasetStatus.FINAL).first()
            )
            graph = session.query(AgentSystemVersionRecord).first()
            prompt = session.query(PromptVersionRecord).first()
            barrier.wait(timeout=5)
            try:
                service.create_run(session, dataset, graph, prompt, ["mock/incident-specialist"])
                return "admitted"
            except EvaluationLimitExceeded:
                return "rejected"

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(lambda _: start(), range(2))) == ["admitted", "rejected"]
        with factory() as session:
            assert session.query(EvalRunRecord).count() == 1
    finally:
        engine.dispose()


def test_redaction_does_not_change_scoring_or_persist_raw_evaluation_copies(
    client, session_factory, monkeypatch
):
    service = client.app.state.evaluation_service
    original = service.runner.provider_registry.get_for_model("mock/incident-specialist")

    class ContactProvider:
        async def complete(self, request):
            response = await original.complete(request)
            if request.task != "classify_incident":
                response.output["output"]["response"] = "Contact person@example.com"
            return response

    class ContactScoring:
        def score_item(self, expected, actual):
            return {"score": float(actual.get("response") == "Contact person@example.com")}

        def aggregate(self, expected_items, actual_items, latencies, costs):
            return {
                "accuracy": float(
                    all(
                        item.get("response") == "Contact person@example.com"
                        for item in actual_items
                    )
                )
            }

    service.scoring_registry = ScoringRegistry([("incident-triage-ground-truth", ContactScoring())])
    monkeypatch.setattr(
        service.runner.provider_registry, "get_for_model", lambda _: ContactProvider()
    )
    response = client.post("/api/eval-runs", json=payload(client))
    assert response.status_code == 201
    assert response.json()["status"] == "complete"
    assert response.json()["results"][0]["metrics"]["accuracy"] == 1
    assert all(item["scores"]["score"] == 1 for item in response.json()["item_results"])
    assert "person@example.com" not in response.text
    with session_factory() as session:
        traces = session.query(TraceRecord).all()
        assert all(trace.output["response"] == "Contact [redacted]" for trace in traces)
