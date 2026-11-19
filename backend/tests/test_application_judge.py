"""Single-trace judging through hosted auth, the provider adapter, and the grade feed."""

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from threading import Event
from uuid import uuid4

import httpx
import pytest
from test_application_capture import feed as feed
from test_hosted import EMAIL, SUBJECT
from test_hosted import hosted as hosted
from test_hosted_migrations import postgres as postgres

from autoeval_api.inference.openrouter import OpenRouterInferenceProvider
from autoeval_api.inference.registry import InferenceProviderRegistry
from autoeval_api.models import FeedObjectRecord
from autoeval_api.services.application_contract import JudgeProfile

MODEL = "openrouter/deepseek/deepseek-v4-flash"


@pytest.fixture
def judge(feed):
    admin, sdk, app, base, _, _, trace = feed
    trace.pop("grantId")
    assert sdk.post("/v2/traces", json=trace).status_code == 201
    app_id = base.rsplit("/", 1)[1]
    profile = JudgeProfile(
        model=MODEL,
        rubric="Pass if the reply addresses the request.",
        evidence={"request": "conversation"},
        daily_call_limit=2,
    )
    app.state.settings.judge_profiles = {app_id: profile}
    app.state.settings.openrouter_api_key = "synthetic-provider-key"
    calls = []

    def install(answer):
        async def handle(request):
            assert request.url == OpenRouterInferenceProvider.api_url
            payload = json.loads(request.content)
            calls.append(payload)
            return httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": await asyncio.to_thread(answer)}}],
                    "model": MODEL.removeprefix("openrouter/"),
                },
            )

        app.state.provider_registry = InferenceProviderRegistry(
            [OpenRouterInferenceProvider(app.state.settings, httpx.MockTransport(handle))]
        )

    install(lambda: '{"grade":false}')
    return admin, sdk, app, app_id, base + "/traces/" + trace["id"], trace, calls, install


def test_operator_judges_once_and_pins_profile(judge):
    admin, sdk, app, app_id, path, trace, calls, _ = judge
    assert sdk.post(path + "/judge").status_code == 403
    app.state.settings.operator_allowlist[SUBJECT] = {
        "role": "viewer",
        "email": EMAIL,
        "resources": [app_id],
    }
    assert admin.post(path + "/judge").status_code == 403
    app.state.settings.operator_allowlist[SUBJECT]["role"] = "admin"
    assert not calls
    result = admin.post(path + "/judge")
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "graded"
    assert admin.post(path + "/judge").json()["status"] == "already_graded"
    assert len(calls) == 1
    wire = calls[0]
    assert wire["provider"]["data_collection"] == "deny"
    assert wire["response_format"]["json_schema"]["strict"] is True
    text = wire["messages"][1]["content"][0]["text"]
    assert json.loads(text.split("State: ", 1)[1]) == {
        "evidence": {"request": trace["content"]["request"]}
    }
    grade = admin.get(path.rsplit("/", 1)[0]).json()[0]["grade"]
    assert grade["id"] == result.json()["gradeId"]
    assert grade["value"] is False and grade["source"] == "judge"
    assert grade["judge"]["model"] == MODEL
    with app.state.session_factory() as session:
        profile = session.get(
            FeedObjectRecord, (app_id, "judge_profile", grade["judge"]["profileId"])
        )
        assert profile.body["rubric"] == app.state.settings.judge_profiles[app_id].rubric
    assert trace["content"]["request"] not in str(grade)
    assert admin.get(path).json()["grades"] == [grade]


def test_disabled_model_evidence_and_definition(judge):
    admin, sdk, app, app_id, path, trace, calls, _ = judge
    profiles = app.state.settings.judge_profiles
    profile = profiles.pop(app_id)
    assert admin.post(path + "/judge").status_code == 409
    profiles[app_id] = profile
    app.state.settings.openrouter_api_key = None
    assert admin.post(path + "/judge").status_code == 503
    app.state.settings.openrouter_api_key = "synthetic-provider-key"
    profiles[app_id] = profile.model_copy(update={"evidence": {"request": "body_scans"}})
    assert admin.post(path + "/judge").json()["status"] == "insufficient_evidence"
    profiles[app_id] = profile
    numeric = {**trace, "id": str(uuid4()), "gradeDefinition": {"kind": "number"}}
    assert sdk.post("/v2/traces", json=numeric).status_code == 201
    assert admin.post(path.replace(trace["id"], numeric["id"]) + "/judge").status_code == 409
    base = path.split("/traces/")[0]
    assert admin.delete(base + "/content").status_code == 200
    assert admin.post(path + "/judge").json()["status"] == "insufficient_evidence"
    assert not calls


@pytest.mark.parametrize(
    "invalid",
    [
        '{"grade":"false","notes":"private provider output"}',
        '{"grade":false,"grade":true}',
    ],
)
def test_invalid_output_abstention_and_daily_budget(judge, invalid):
    admin, _, _, _, path, _, calls, install = judge
    install(lambda: invalid)
    result = admin.post(path + "/judge")
    assert result.status_code == 502 and "private" not in result.text
    install(lambda: '{"grade":null}')
    assert admin.post(path + "/judge").json()["status"] == "insufficient_evidence"
    assert admin.post(path + "/judge").status_code == 429
    assert len(calls) == 2 and admin.get(path).json()["grades"] == []


@pytest.mark.parametrize("during_call", ["client_grade", "erase"])
def test_inflight_judge_rechecks_at_save(judge, during_call):
    admin, sdk, _, _, path, trace, calls, install = judge
    started, release = Event(), Event()

    def answer():
        started.set()
        assert release.wait(8)
        return '{"grade":true}'

    install(answer)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(admin.post, path + "/judge")
        try:
            assert started.wait(8)
            assert admin.post(path + "/judge").status_code == 409
            if during_call == "client_grade":
                assert (
                    sdk.post(
                        "/v2/traces/" + trace["id"] + "/grades", json={"value": False}
                    ).status_code
                    == 201
                )
            else:
                assert admin.delete(path.split("/traces/")[0] + "/content").status_code == 200
        finally:
            release.set()
        result = future.result(timeout=8)
    expected = "already_graded" if during_call == "client_grade" else "insufficient_evidence"
    assert result.json()["status"] == expected
    assert len(calls) == 1
    assert all(grade["source"] == "client" for grade in admin.get(path).json()["grades"])


def test_sdk_flag_requests_one_server_grade_and_replay_keeps_receipt(judge):
    admin, sdk, app, app_id, path, trace, calls, _ = judge
    profiles = app.state.settings.judge_profiles
    flagged = {**trace, "id": str(uuid4()), "llmJudge": True}
    assert sdk.post("/v2/traces", json=flagged).json()["judgeRequest"] == "disabled"
    profiles[app_id] = profiles[app_id].model_copy(update={"allow_sdk_requests": True})
    assert sdk.post("/v2/traces", json=flagged).json()["judgeRequest"] == "disabled"
    assert "judgeRequest" not in sdk.post("/v2/traces", json={**trace, "llmJudge": False}).json()
    numeric = {**flagged, "id": str(uuid4()), "gradeDefinition": {"kind": "number"}}
    assert sdk.post("/v2/traces", json=numeric).json()["judgeRequest"] == "unsupported_grade"
    assert not calls

    flagged["id"] = str(uuid4())
    for _ in range(2):
        response = sdk.post("/v2/traces", json=flagged)
        assert response.status_code == 201
        assert response.json()["judgeRequest"] == "accepted"
    assert len(calls) == 1
    (grade,) = admin.get(path.replace(trace["id"], flagged["id"])).json()["grades"]
    assert grade["source"] == "judge" and grade["value"] is False
    assert sdk.post("/v2/traces", json={**flagged, "llmJudge": False}).status_code == 409


@pytest.mark.parametrize("changed_profile", [False, True])
def test_sdk_worker_recovers_a_stored_request_and_checks_approval(
    judge, monkeypatch, changed_profile
):
    from autoeval_api.api.routes import applications
    from autoeval_api.models import JudgeRequestRecord

    _, sdk, app, app_id, _, trace, calls, _ = judge
    profiles = app.state.settings.judge_profiles
    profiles[app_id] = profiles[app_id].model_copy(update={"allow_sdk_requests": True})

    async def interrupted(*args):
        pass

    dispatch = applications.dispatch_after_capture
    monkeypatch.setattr(applications, "dispatch_after_capture", interrupted)
    item = {**trace, "id": str(uuid4()), "llmJudge": True}
    assert sdk.post("/v2/traces", json=item).json()["judgeRequest"] == "accepted"
    assert not calls
    with app.state.session_factory() as session:
        job = session.get(JudgeRequestRecord, (app_id, item["id"]))
        assert job.attempts == 0
    if changed_profile:
        profiles[app_id] = profiles[app_id].model_copy(update={"rubric": "Different rule"})
    monkeypatch.setattr(applications, "dispatch_after_capture", dispatch)
    assert sdk.post("/v2/traces", json={**trace, "id": str(uuid4())}).status_code == 201
    assert len(calls) == (0 if changed_profile else 1)
    with app.state.session_factory() as session:
        assert session.get(JudgeRequestRecord, (app_id, item["id"])) is None


def test_sdk_transient_failure_recovers_once_after_backoff(judge):
    from autoeval_api.models import JudgeRequestRecord

    admin, sdk, app, app_id, path, trace, calls, install = judge
    profiles = app.state.settings.judge_profiles
    profiles[app_id] = profiles[app_id].model_copy(update={"allow_sdk_requests": True})
    item = {**trace, "id": str(uuid4()), "llmJudge": True}
    install(lambda: '{"grade":"invalid"}')
    for _ in range(2):
        assert sdk.post("/v2/traces", json=item).json()["judgeRequest"] == "accepted"
    assert len(calls) == 1
    with app.state.session_factory() as session:
        job = session.get(JudgeRequestRecord, (app_id, item["id"]))
        assert job.attempts == 1
        job.ready_at = 0
        session.commit()

    install(lambda: '{"grade":true}')
    assert sdk.post("/v2/traces", json={**trace, "id": str(uuid4())}).status_code == 201
    (grade,) = admin.get(path.replace(trace["id"], item["id"])).json()["grades"]
    assert grade["source"] == "judge" and grade["value"] is True
    assert len(calls) == 2


@pytest.mark.parametrize("before_send", ["erase", "expire_content", "expire_lease"])
@pytest.mark.parametrize("sdk_requested", [False, True])
def test_dispatch_rechecks_before_any_provider_body(judge, monkeypatch, before_send, sdk_requested):
    from autoeval_api.inference.base import InferenceRequest
    from autoeval_api.models import JudgeLeaseRecord, JudgeRequestRecord
    from autoeval_api.services import application_feed as feed_service
    from autoeval_api.services.application_judge import run_sdk_request

    admin, sdk, app, app_id, path, trace, calls, _ = judge
    trace_id = str(uuid4()) if sdk_requested else trace["id"]
    profiles = app.state.settings.judge_profiles
    profiles[app_id] = profiles[app_id].model_copy(update={"allow_sdk_requests": True})
    now = feed_service.now_ms()
    monkeypatch.setattr(feed_service, "now_ms", lambda: now)
    ready, proceed = Event(), Event()
    original = InferenceRequest.http_body

    @asynccontextmanager
    async def paused_body(request, data):
        ready.set()
        assert await asyncio.to_thread(proceed.wait, 8)
        async with original(request, data) as body:
            yield body

    monkeypatch.setattr(InferenceRequest, "http_body", paused_body)
    with ThreadPoolExecutor(max_workers=1) as pool:
        if sdk_requested:
            future = pool.submit(
                sdk.post, "/v2/traces", json={**trace, "id": trace_id, "llmJudge": True}
            )
        else:
            future = pool.submit(admin.post, path + "/judge")
        try:
            assert ready.wait(8)
            if before_send == "erase":
                assert admin.delete(path.split("/traces/")[0] + "/content").status_code == 200
            elif before_send == "expire_content":
                with app.state.session_factory() as session:
                    session.get(FeedObjectRecord, (app_id, "content2", trace_id)).expires = now + 1
                    session.commit()
                now += 1
            else:
                with app.state.session_factory() as session:
                    now = int(session.get(JudgeLeaseRecord, (app_id, trace_id)).expires)
        finally:
            proceed.set()
        result = future.result(timeout=8)
    if sdk_requested:
        assert result.status_code == 201 and result.json()["judgeRequest"] == "accepted"
    elif before_send == "expire_lease":
        assert result.status_code == 409
    else:
        assert result.status_code == 200 and result.json()["status"] == "insufficient_evidence"
    assert calls == []
    trace_path = path.replace(trace["id"], trace_id)
    assert admin.get(trace_path).json()["grades"] == []
    if sdk_requested:
        with app.state.session_factory() as session:
            job = session.get(JudgeRequestRecord, (app_id, trace_id))
            if before_send != "expire_lease":
                assert job is None
                return
            assert job.attempts == 1 and job.ready_at > now
            now = int(job.ready_at)
        asyncio.run(run_sdk_request(app.state, app_id, trace_id))
        assert len(calls) == 1
        (grade,) = admin.get(trace_path).json()["grades"]
        assert grade["source"] == "judge" and grade["value"] is False
        with app.state.session_factory() as session:
            assert session.get(JudgeRequestRecord, (app_id, trace_id)) is None


def test_budget_limited_sdk_retry_survives_until_next_utc_window(judge, monkeypatch):
    from autoeval_api.models import JudgeRequestRecord
    from autoeval_api.services import application_feed as feed_service
    from autoeval_api.services.application_judge import run_sdk_request

    admin, sdk, app, app_id, path, trace, calls, install = judge
    profiles = app.state.settings.judge_profiles
    profiles[app_id] = profiles[app_id].model_copy(
        update={"allow_sdk_requests": True, "daily_call_limit": 1}
    )
    now = (feed_service.now_ms() // 86_400_000 + 1) * 86_400_000
    monkeypatch.setattr(feed_service, "now_ms", lambda: now)
    install(lambda: '{"grade":"invalid"}')
    item = {**trace, "id": str(uuid4()), "llmJudge": True}
    assert sdk.post("/v2/traces", json=item).json()["judgeRequest"] == "accepted"
    now += 120_001
    asyncio.run(run_sdk_request(app.state, app_id, item["id"]))
    with app.state.session_factory() as session:
        job = session.get(JudgeRequestRecord, (app_id, item["id"]))
        assert job.attempts == 1
        assert job.ready_at == (now // 86_400_000 + 1) * 86_400_000
        now = int(job.ready_at)
    assert len(calls) == 1
    install(lambda: '{"grade":true}')
    asyncio.run(run_sdk_request(app.state, app_id, item["id"]))
    assert len(calls) == 2
    assert admin.get(path.replace(trace["id"], item["id"])).json()["grades"][0]["value"] is True


def test_stale_worker_cannot_remove_a_deferred_job(judge, monkeypatch):
    from autoeval_api.api.routes import applications
    from autoeval_api.models import JudgeRequestRecord
    from autoeval_api.services import application_feed as feed_service
    from autoeval_api.services import application_judge as service

    admin, sdk, app, app_id, path, trace, calls, _ = judge
    profiles = app.state.settings.judge_profiles
    profiles[app_id] = profiles[app_id].model_copy(
        update={"allow_sdk_requests": True, "daily_call_limit": 1}
    )
    now = (feed_service.now_ms() // 86_400_000 + 1) * 86_400_000
    monkeypatch.setattr(feed_service, "now_ms", lambda: now)
    assert admin.post(path + "/judge").json()["status"] == "graded"

    async def queue_only(*args):
        pass

    monkeypatch.setattr(applications, "dispatch_after_capture", queue_only)
    trace_id = str(uuid4())
    item = {**trace, "id": trace_id, "llmJudge": True}
    assert sdk.post("/v2/traces", json=item).json()["judgeRequest"] == "accepted"
    factory = app.state.session_factory
    first = service._claim_request(factory, app_id, trace_id, profiles)
    now += service.RETRY_MS + 1
    second = service._claim_request(factory, app_id, trace_id, profiles)
    assert first and second and first != second
    args = (factory, None, app_id, trace_id, profiles, app.state.provider_registry)
    with pytest.raises(service.AdmissionDeferred) as stale:
        service._prepare(*args, first)
    assert stale.value.status_code == 409
    with pytest.raises(service.AdmissionDeferred) as deferred:
        service._prepare(*args, second)
    assert deferred.value.status_code == 429
    for claim_id in (first, second):
        service._remove_request(factory, app_id, trace_id, claim_id)
    with factory() as session:
        job = session.get(JudgeRequestRecord, (app_id, trace_id))
        assert job.claim_id is None and job.attempts == 0
        assert job.ready_at == (now // 86_400_000 + 1) * 86_400_000
        now = int(job.ready_at)
    assert len(calls) == 1
    asyncio.run(service.run_sdk_request(app.state, app_id, trace_id))
    assert len(calls) == 2
    (grade,) = admin.get(path.replace(trace["id"], trace_id)).json()["grades"]
    assert grade["source"] == "judge"


def test_cancelled_claim_preserves_last_inference_attempt(judge, monkeypatch):
    from autoeval_api.models import JudgeRequestRecord
    from autoeval_api.services import application_feed as feed_service
    from autoeval_api.services import application_judge as service

    admin, sdk, app, app_id, path, trace, calls, install = judge
    profiles = app.state.settings.judge_profiles
    profiles[app_id] = profiles[app_id].model_copy(
        update={"allow_sdk_requests": True, "daily_call_limit": service.MAX_SDK_ATTEMPTS}
    )
    now = (feed_service.now_ms() // 86_400_000 + 1) * 86_400_000
    monkeypatch.setattr(feed_service, "now_ms", lambda: now)
    install(lambda: '{"grade":"invalid"}')
    trace_id = str(uuid4())
    item = {**trace, "id": trace_id, "llmJudge": True}
    assert sdk.post("/v2/traces", json=item).json()["judgeRequest"] == "accepted"
    for _ in range(1, service.MAX_SDK_ATTEMPTS - 1):
        now += service.RETRY_MS + 1
        asyncio.run(service.run_sdk_request(app.state, app_id, trace_id))

    async def cancel_before_admission():
        claimed = asyncio.Event()

        async def wait_for_cancellation(*args, **kwargs):
            claimed.set()
            await asyncio.Future()

        with monkeypatch.context() as patch:
            patch.setattr(service, "judge_trace", wait_for_cancellation)
            task = asyncio.create_task(service.run_sdk_request(app.state, app_id, trace_id))
            try:
                await asyncio.wait_for(claimed.wait(), timeout=8)
            finally:
                task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await task

    now += service.RETRY_MS + 1
    asyncio.run(cancel_before_admission())
    with app.state.session_factory() as session:
        job = session.get(JudgeRequestRecord, (app_id, trace_id))
        assert job.claim_id and job.attempts == service.MAX_SDK_ATTEMPTS - 1
        now = int(job.ready_at)
    assert len(calls) == service.MAX_SDK_ATTEMPTS - 1
    install(lambda: '{"grade":true}')
    asyncio.run(service.run_sdk_request(app.state, app_id, trace_id))
    assert len(calls) == service.MAX_SDK_ATTEMPTS
    (grade,) = admin.get(path.replace(trace["id"], trace_id)).json()["grades"]
    assert grade["value"] is True
    with app.state.session_factory() as session:
        assert session.get(JudgeRequestRecord, (app_id, trace_id)) is None


@pytest.mark.parametrize("other_app", [False, True])
def test_active_operator_lease_bounds_operator_and_sdk_admission(judge, monkeypatch, other_app):
    from test_application_capture import experiment, policy

    from autoeval_api.models import JudgeRequestRecord
    from autoeval_api.services import application_judge

    admin, sdk, app, app_id, path, trace, calls, install = judge
    profiles = app.state.settings.judge_profiles
    monkeypatch.setattr(application_judge, "APP_CONCURRENCY", 1)
    monkeypatch.setattr(application_judge, "INSTANCE_CONCURRENCY", 1 if other_app else 2)
    target = str(uuid4()) if other_app else app_id
    if other_app:
        created = admin.post(
            "/api/applications",
            json={"id": target, "name": "Second app", "key": {"expiresAt": None}},
        )
        assert created.status_code == 201
        sdk.headers["authorization"] = "Bearer " + created.json()["key"]["token"]
        assert (
            sdk.post(
                "/v2/connect", json={"policy": policy(), "experiment": experiment()}
            ).status_code
            == 200
        )
    profiles[target] = profiles[app_id].model_copy(update={"allow_sdk_requests": True})
    item = {**trace, "id": str(uuid4()), "llmJudge": True}
    started, release = Event(), Event()

    def answer():
        started.set()
        assert release.wait(8)
        return '{"grade":true}'

    install(answer)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(admin.post, path + "/judge")
        try:
            assert started.wait(8)
            assert sdk.post("/v2/traces", json=item).json()["judgeRequest"] == "accepted"
            target_path = f"/api/applications/{target}/traces/{item['id']}"
            assert admin.post(target_path + "/judge").status_code == 429
            with app.state.session_factory() as session:
                job = session.get(JudgeRequestRecord, (target, item["id"]))
                assert job.attempts == 0
                job.ready_at = 0
                session.commit()
            assert len(calls) == 1
        finally:
            release.set()
        assert future.result(timeout=8).json()["status"] == "graded"
    asyncio.run(application_judge.run_sdk_request(app.state, target, item["id"]))
    assert len(calls) == 2
    assert admin.get(target_path).json()["grades"][0]["value"] is True


def test_concurrent_requests_share_last_daily_call(judge, monkeypatch):
    from autoeval_api.models import JudgeRequestRecord
    from autoeval_api.services import application_feed as feed_service
    from autoeval_api.services.application_judge import run_sdk_request

    admin, sdk, app, app_id, path, trace, calls, install = judge
    profiles = app.state.settings.judge_profiles
    profiles[app_id] = profiles[app_id].model_copy(
        update={"allow_sdk_requests": True, "daily_call_limit": 1}
    )
    now = (feed_service.now_ms() // 86_400_000 + 1) * 86_400_000
    monkeypatch.setattr(feed_service, "now_ms", lambda: now)
    started, release = Event(), Event()

    def answer():
        started.set()
        assert release.wait(8)
        return '{"grade":true}'

    install(answer)
    item = {**trace, "id": str(uuid4()), "llmJudge": True}
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(admin.post, path + "/judge")
        try:
            assert started.wait(8)
            assert sdk.post("/v2/traces", json=item).json()["judgeRequest"] == "accepted"
            with app.state.session_factory() as session:
                job = session.get(JudgeRequestRecord, (app_id, item["id"]))
                assert job.attempts == 0 and job.ready_at == now + 86_400_000
        finally:
            release.set()
        assert future.result(timeout=8).json()["status"] == "graded"
    assert len(calls) == 1
    now += 86_400_000
    asyncio.run(run_sdk_request(app.state, app_id, item["id"]))
    assert len(calls) == 2
