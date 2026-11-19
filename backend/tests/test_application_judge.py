"""Single-trace judging through hosted auth, the provider adapter, and the grade feed."""

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
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
