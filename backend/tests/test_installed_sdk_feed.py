"""A packed, offline-installed SDK sends a synthetic trace to the real FastAPI server."""

import json
import os
import socket
import subprocess
import threading
import time
from pathlib import Path
from uuid import uuid4

import httpx
import uvicorn
from sqlalchemy import create_engine

from autoeval_api.app import create_application
from autoeval_api.config import Settings
from autoeval_api.db import build_session_factory
from autoeval_api.migration_cli import upgrade


def test_installed_env_consumer_against_fastapi(tmp_path):
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
    server = uvicorn.Server(uvicorn.Config(app, log_level="error", lifespan="off"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.01)
        assert server.started
        with httpx.Client(base_url=endpoint) as client:
            app_id = str(uuid4())
            assert (
                client.post(
                    "/api/applications",
                    json={
                        "id": app_id,
                        "name": "Installed SDK fixture",
                        "environment": "test",
                        "policy": {"metrics": ["latency_ms"], "checks": ["passed"]},
                        "retention_days": 1,
                    },
                ).status_code
                == 201
            )
            keys = {
                scope: client.post(
                    f"/api/applications/{app_id}/keys", json={"scope": scope}
                ).json()["token"]
                for scope in ("traces:write", "grants:write")
            }
            experiment = str(uuid4())
            assert (
                client.post(
                    f"/api/applications/{app_id}/experiments",
                    json={
                        "id": experiment,
                        "revision": "a" * 40,
                        "promptHash": "b" * 64,
                        "configHash": "c" * 64,
                        "graphHash": None,
                        "model": "synthetic/mock",
                        "mode": "observed",
                        "datasetHash": None,
                    },
                ).status_code
                == 201
            )
            now = int(time.time() * 1000)
            grant = {
                "id": str(uuid4()),
                "source": "synthetic",
                "expiresAt": now + 600000,
                "policy": "metadata-v1",
            }
            assert (
                client.post(
                    "/v1/grants",
                    headers={"authorization": "Bearer " + keys["grants:write"]},
                    json=grant,
                ).status_code
                == 201
            )
            root = Path(__file__).resolve().parents[2]
            env = {**os.environ, "npm_config_cache": str(tmp_path / "npm-cache")}
            subprocess.run(
                ["npm", "pack", "--pack-destination", str(tmp_path)],
                cwd=root / "packages/trace-feed",
                env=env,
                check=True,
                capture_output=True,
                timeout=60,
            )
            (tmp_path / "package.json").write_text('{"private":true,"type":"module"}')
            subprocess.run(
                [
                    "npm",
                    "install",
                    "--offline",
                    "--no-audit",
                    "--no-fund",
                    "./devalparikh-autoeval-0.1.0.tgz",
                ],
                cwd=tmp_path,
                env=env,
                check=True,
                capture_output=True,
                timeout=60,
            )
            (tmp_path / "consumer.mjs").write_text("""
import { createCaptureFromEnv } from '@devalparikh/autoeval';
import { readFileSync } from 'node:fs';
const {env, consent, startedAt} = JSON.parse(readFileSync(0, 'utf8'));
const capture = createCaptureFromEnv({ env, policy: {metrics:['latency_ms'],checks:['passed']} });
const receipt = await capture.capture({consent, startedAt, endedAt:startedAt+1,
 project:()=>({metrics:{latency_ms:1},checks:{passed:true}})});
if (receipt.status !== 'accepted') throw new Error('synthetic SDK receipt failed');
console.log(JSON.stringify(receipt));
""")
            result = subprocess.run(
                ["node", "consumer.mjs"],
                cwd=tmp_path,
                env=env,
                input=json.dumps(
                    {
                        "env": {
                            "AUTOEVAL_ENABLED": "true",
                            "AUTOEVAL_ENDPOINT": endpoint + "/v1/traces",
                            "AUTOEVAL_INGEST_KEY": keys["traces:write"],
                            "AUTOEVAL_EXPERIMENT_ID": experiment,
                            "AUTOEVAL_SOURCE": "synthetic",
                            "AUTOEVAL_REQUEST_TIMEOUT_MS": "2000",
                        },
                        "consent": grant,
                        "startedAt": now,
                    }
                ),
                text=True,
                capture_output=True,
                check=True,
                timeout=10,
            )
            receipt = json.loads(result.stdout)
            rows = client.get(f"/api/applications/{app_id}/traces").json()
            assert [row["id"] for row in rows] == [receipt["id"]]
            assert (
                client.delete(
                    "/v1/grants/" + grant["id"],
                    headers={"authorization": "Bearer " + keys["grants:write"]},
                ).status_code
                == 200
            )
            assert client.get(f"/api/applications/{app_id}/traces").json() == []
    finally:
        server.should_exit = True
        thread.join(10)
        sock.close()
        engine.dispose()
