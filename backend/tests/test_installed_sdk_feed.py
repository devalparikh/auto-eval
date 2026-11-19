"""A packed, offline-installed SDK exercises the real v2 backend over loopback."""

import asyncio
import json
import os
import socket
import subprocess
import threading
import time
from pathlib import Path

import httpx
import uvicorn
from sqlalchemy import create_engine

from autoeval_api.app import create_application
from autoeval_api.config import Settings
from autoeval_api.db import build_session_factory
from autoeval_api.inference.openrouter import OpenRouterInferenceProvider
from autoeval_api.inference.registry import InferenceProviderRegistry
from autoeval_api.migration_cli import upgrade
from autoeval_api.services.application_contract import JudgeProfile


def test_installed_sdk_capture_versions_outcomes_and_withdrawal(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path}/feed.db", connect_args={"check_same_thread": False}
    )
    upgrade(engine)
    app = create_application(
        settings=Settings(
            _env_file=None,
            AUTOEVAL_ENV="test",
            allowed_hosts=["127.0.0.1"],
            database_url=f"sqlite:///{tmp_path}/feed.db",
        ),
        engine=engine,
        session_factory=build_session_factory(engine),
        initialize_database=False,
        seed_on_start=False,
    )
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    endpoint = f"http://127.0.0.1:{sock.getsockname()[1]}"
    server = uvicorn.Server(
        uvicorn.Config(app, log_level="error", lifespan="off", access_log=False)
    )
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.01)
        assert server.started
        root = Path(__file__).resolve().parents[2]
        env = {**os.environ, "npm_config_cache": str(tmp_path / "npm-cache")}
        subprocess.run(
            ["npm", "pack", "--pack-destination", str(tmp_path)],
            cwd=root / "packages/trace-feed",
            env=env,
            check=True,
            capture_output=True,
        )
        package = next(tmp_path.glob("*.tgz"))
        (tmp_path / "package.json").write_text('{"private":true,"type":"module"}')
        subprocess.run(
            [
                "npm",
                "install",
                "--offline",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
                str(package),
            ],
            cwd=tmp_path,
            env=env,
            check=True,
            capture_output=True,
        )
        with httpx.Client(base_url=endpoint) as client:
            created = client.post(
                "/api/applications",
                json={
                    "name": "Installed fixture",
                    "key": {"expiresAt": int(time.time() * 1000) + 600000},
                },
            )
            assert created.status_code == 201
            app_id, token = created.json()["id"], created.json()["key"]["token"]
            # Hold inference open until the Node process receives its receipt and exits.
            release_judge = threading.Event()

            async def provider_response(request):
                assert await asyncio.to_thread(release_judge.wait, 15)
                return httpx.Response(
                    200, json={"choices": [{"message": {"content": '{"grade":true}'}}]}
                )

            app.state.settings.openrouter_api_key = "synthetic-key"
            app.state.settings.judge_profiles[app_id] = JudgeProfile(
                model="openrouter/openai/gpt-5-mini",
                rubric="Does the reply answer the question?",
                evidence={"message": "conversation"},
                allow_sdk_requests=True,
            )
            app.state.provider_registry = InferenceProviderRegistry(
                [
                    OpenRouterInferenceProvider(
                        app.state.settings, httpx.MockTransport(provider_response)
                    )
                ]
            )
            script = tmp_path / "consumer.mjs"
            script.write_text("""
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCaptureFromEnv,createTraceClient} from '@devalparikh/autoeval';
const policy={schemaVersion:2,
metrics:{latency_ms:{semanticId:'run.latency',definitionVersion:1,unit:'ms'}},
checks:{valid:{semanticId:'reply.valid',definitionVersion:1,expected:true}},
outcomes:{proposal_decision:{
attributes:{decision:{type:'string',enum:['applied','dismissed','stale']}}}},
content:{message:{category:'conversation',valueSchema:{type:'string'}}}};
const experiment={revision:{kind:'git-sha1',value:'a'.repeat(40)},
promptHash:'b'.repeat(64),configHash:'c'.repeat(64),graphHash:null,
models:[{role:'trainer',provider:'mock',model:'synthetic/mock'}]};
const consent={granted:true,id:randomUUID(),categories:['conversation']};
const sdk=createCaptureFromEnv({policy,experiment,redactorVersion:'d'.repeat(64)});
assert.equal(sdk.enabled,true);
assert.equal(sdk.begin().reference,null);
const run=sdk.begin({consent});
assert.equal((await run.end({metrics:{latency_ms:12},
checks:{valid:true},
content:{message:'Synthetic person@example.invalid'}})).status,'accepted');
const policy2={...policy,
metrics:{...policy.metrics,
provider_attempts:{semanticId:'provider.attempts',definitionVersion:1,unit:'count'}}};
const next=createCaptureFromEnv({policy:policy2,experiment,redactorVersion:'d'.repeat(64)});
const run2=next.begin({consent});
assert.notEqual(run.reference.policyVersion,run2.reference.policyVersion);
assert.equal((await run2.end({metrics:{latency_ms:13,
provider_attempts:2},
checks:{valid:true}})).status,'accepted');
assert.equal((await next.outcome({consent,reference:run.reference,
name:'proposal_decision',
attributes:{decision:'applied'}})).status,'accepted');
const appClient=createTraceClient({policy,experiment,redactorVersion:'d'.repeat(64)});
const appRun=appClient.begin();
assert.ok(appRun.reference);
assert.equal('grantId' in appRun.reference,false);
assert.equal('withdraw' in appClient,false);
assert.equal((await appRun.end({content:{message:'App-selected example'}})).status,'accepted');
const eventId = randomUUID();
const decision = {traceId:appRun.reference.traceId,value:false,id:eventId,reason:"Wrong workout"};
assert.equal((await appClient.grade(decision)).status,'accepted');
assert.equal((await appClient.grade(decision)).status,'accepted');
assert.equal((await appClient.grade({...decision,value:true})).status,'skipped');
const wrongType = {...decision,id:randomUUID(),value:"wrong type"};
assert.equal((await appClient.grade(wrongType)).status,'skipped');
assert.equal((await appClient.outcome({reference:appRun.reference,name:'proposal_decision',
attributes:{decision:'dismissed'}})).status,'accepted');
const flagged = appClient.begin({llmJudge:true});
const receipt = await flagged.end({content:{message:'Synthetic judge evidence'}});
assert.equal(receipt.status,'accepted');
assert.equal(receipt.judgeRequest,'accepted');
process.stdout.write(JSON.stringify({judgeTraceId:flagged.reference.traceId,
reference:run.reference,grantId:consent.id,
appTraceId:appRun.reference.traceId}));
""")
            output = subprocess.run(
                ["node", str(script)],
                cwd=tmp_path,
                env={
                    **env,
                    "AUTOEVAL_ENABLED": "true",
                    "AUTOEVAL_ENDPOINT": endpoint + "/v2/traces",
                    "AUTOEVAL_INGEST_KEY": token,
                    "AUTOEVAL_SOURCE": "synthetic",
                },
                capture_output=True,
                check=False,
                text=True,
            )
            # Never include process output/environment in assertion failures.
            release_judge.set()
            assert output.returncode == 0, "Installed SDK consumer failed"
            result = json.loads(output.stdout)
            base = f"/api/applications/{app_id}"
            assert len(client.get(base + "/traces").json()) == 4
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                grades = client.get(base + "/traces/" + result["judgeTraceId"]).json()["grades"]
                if grades:
                    break
                time.sleep(0.02)
            assert (
                len(grades) == 1 and grades[0]["source"] == "judge" and grades[0]["value"] is True
            )
            detail = client.get(
                base + "/traces/" + result["reference"]["traceId"] + "/content"
            ).json()
            assert (
                detail["content"][result["reference"]["traceId"]]["message"]
                == "Synthetic [redacted]"
            )
            assert detail["outcomes"][0]["attributes"]["decision"] == "applied"
            response = client.delete(
                "/v2/grants/" + result["grantId"], headers={"authorization": "Bearer " + token}
            )
            assert response.status_code == 200
            assert {row["id"] for row in client.get(base + "/traces").json()} == {
                result["appTraceId"],
                result["judgeTraceId"],
            }
            detail = client.get(base + "/traces/" + result["appTraceId"] + "/content").json()
            assert detail["content"][result["appTraceId"]]["message"] == "App-selected example"
            assert detail["outcomes"][0]["attributes"]["decision"] == "dismissed"
            assert len(detail["grades"]) == 1
            grade = detail["grades"][0]
            assert grade["value"] is False
            assert detail["content"]["grade-" + grade["id"]]["reason"] == "Wrong workout"
            assert (
                next(
                    row
                    for row in client.get(base + "/traces").json()
                    if row["id"] == result["appTraceId"]
                )["grade"]
                == grade
            )
    finally:
        server.should_exit = True
        thread.join(5)
        sock.close()
        engine.dispose()
