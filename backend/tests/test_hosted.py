import time
from types import SimpleNamespace
from uuid import uuid4

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_hosted_migrations import postgres as postgres

from autoeval_api.app import create_application
from autoeval_api.config import Settings
from autoeval_api.db import build_session_factory
from autoeval_api.migration_cli import upgrade
from autoeval_api.models import ApplicationKeyRecord, HostedSessionRecord
from autoeval_api.services.hosted_auth import COOKIE, digest

ORIGIN = "https://testserver"
SUBJECT = str(uuid4())
EMAIL = "operator@example.invalid"


@pytest.fixture(params=["sqlite", "postgres"])
def hosted(request, session_factory, monkeypatch):
    if request.param == "postgres":
        engine = request.getfixturevalue("postgres")
        upgrade(engine)
        session_factory = build_session_factory(engine)
    settings = Settings(
        AUTOEVAL_ENV="test",
        auth_mode="supabase",
        supabase_url="https://auth.example.invalid",
        supabase_publishable_key="test-publishable",
        operator_allowlist={SUBJECT: {"email": EMAIL, "role": "admin"}},
        allowed_hosts=["testserver"],
        web_origins=[ORIGIN],
    )
    app = create_application(
        settings=settings,
        session_factory=session_factory,
        initialize_database=False,
        seed_on_start=False,
    )
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(
        app.state.hosted_auth.jwks,
        "get_signing_key_from_jwt",
        lambda _: SimpleNamespace(key=private.public_key()),
    )
    claims = {
        "sub": SUBJECT,
        "email": EMAIL,
        "aud": "authenticated",
        "iss": settings.supabase_url + "/auth/v1",
        "iat": int(time.time()),
        "exp": int(time.time()) + 600,
    }
    token = jwt.encode(claims, private, algorithm="RS256", headers={"kid": "test"})
    calls = []

    def post(url, **kwargs):
        calls.append((url, kwargs["json"]))
        if url.endswith("/verify"):
            if kwargs["json"]["token"] != "123456":
                return httpx.Response(400, json={})
            return httpx.Response(200, json={"access_token": token})
        return httpx.Response(200, json={})

    monkeypatch.setattr("autoeval_api.api.routes.auth.httpx.post", post)
    monkeypatch.setattr(
        "autoeval_api.services.hosted_auth.httpx.get",
        lambda *a, **k: httpx.Response(
            200, json={"id": SUBJECT, "email": EMAIL, "email_confirmed_at": "2026-01-01"}
        ),
    )
    with TestClient(app, base_url=ORIGIN) as client:
        yield client, app, calls, private, claims


def login(client):
    result = client.post(
        "/api/auth/verify", json={"email": EMAIL, "token": "123456"}, headers={"origin": ORIGIN}
    )
    assert result.status_code == 200, result.text
    assert "HttpOnly" in result.headers["set-cookie"] and "Secure" in result.headers["set-cookie"]
    client.headers["origin"] = ORIGIN


def test_otp_and_server_wide_boundary(hosted):
    client, app, calls, _, _ = hosted
    for path in [
        "/api/catalog",
        "/api/traces",
        "/api/applications",
        "/openapi.json",
        "/api/auth/session",
    ]:
        assert client.get(path).status_code == 401
    assert client.get("/api/health").status_code == 200
    assert client.post("/api/auth/request", json={"email": EMAIL}).status_code == 403
    first = client.post("/api/auth/request", json={"email": EMAIL}, headers={"origin": ORIGIN})
    second = client.post(
        "/api/auth/request", json={"email": "unknown@example.invalid"}, headers={"origin": ORIGIN}
    )
    assert first.json() == second.json()
    assert calls[0][1] == {"email": EMAIL, "create_user": False}
    assert (
        client.post(
            "/api/auth/verify", json={"email": EMAIL, "token": "000000"}, headers={"origin": ORIGIN}
        ).status_code
        == 401
    )
    login(client)
    assert calls[-1][1]["type"] == "email"
    assert client.get("/api/catalog").status_code == 200
    del client.headers["origin"]
    assert client.post("/api/auth/logout").status_code == 403
    client.headers["origin"] = ORIGIN
    cookie = client.cookies.get(COOKIE)
    assert client.post("/api/auth/logout").status_code == 200
    client.cookies.set(COOKIE, cookie)
    assert client.get("/api/catalog").status_code == 401
    with app.state.session_factory() as session:
        assert session.get(HostedSessionRecord, digest(cookie)) is None


def test_jwt_claims_and_allowlist(hosted, monkeypatch):
    client, app, _, private, claims = hosted
    auth = app.state.hosted_auth
    for change in [
        {"aud": "wrong"},
        {"iss": "https://wrong.invalid"},
        {"exp": 1},
        {"sub": str(uuid4())},
        {"email": "other@example.invalid"},
    ]:
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            auth.verify_token(jwt.encode({**claims, **change}, private, algorithm="RS256"))
    from fastapi import HTTPException

    with pytest.raises(HTTPException):
        auth.verify_token(jwt.encode(claims, "untrusted-key" * 4, algorithm="HS256"))
    monkeypatch.setattr(
        "autoeval_api.services.hosted_auth.httpx.get",
        lambda *a, **k: httpx.Response(
            200, json={"id": SUBJECT, "email": EMAIL, "email_confirmed_at": None}
        ),
    )
    with pytest.raises(HTTPException):
        auth.verify_token(jwt.encode(claims, private, algorithm="RS256"))
    app.state.settings.operator_allowlist = {}
    assert (
        client.post(
            "/api/auth/verify", json={"email": EMAIL, "token": "123456"}, headers={"origin": ORIGIN}
        ).status_code
        == 401
    )


def test_live_allowlist_and_rate_limit(hosted):
    client, app, _, _, _ = hosted
    login(client)
    app.state.settings.operator_allowlist = {}
    assert client.get("/api/catalog").status_code == 401
    for _ in range(3):
        assert client.post("/api/auth/request", json={"email": EMAIL}).status_code == 200
    assert client.post("/api/auth/request", json={"email": EMAIL}).status_code == 429


def test_feed_lifecycle_permissions_consent_and_restart(hosted):
    client, app, _, _, _ = hosted
    login(client)
    app_id, other_id = str(uuid4()), str(uuid4())
    for id in [app_id, other_id]:
        assert (
            client.post(
                "/api/applications",
                json={
                    "id": id,
                    "name": "Synthetic demo",
                    "environment": "preview",
                    "policy": {"metrics": ["latency_ms"], "checks": ["passed"]},
                    "retention_days": 1,
                },
            ).status_code
            == 201
        )
    issued = {}
    for scope in ["traces:write", "grants:write", "traces:read"]:
        issued[scope] = client.post(
            f"/api/applications/{app_id}/keys", json={"scope": scope}
        ).json()
    with app.state.session_factory() as session:
        for row in session.scalars(select(ApplicationKeyRecord)):
            assert row.digest.startswith("ae_") is False
            assert all(key["token"] not in row.digest for key in issued.values())
    experiment = {
        "id": str(uuid4()),
        "revision": "a" * 40,
        "promptHash": "b" * 64,
        "configHash": "c" * 64,
        "graphHash": None,
        "model": "synthetic/mock",
        "mode": "observed",
        "datasetHash": None,
    }
    assert (
        client.post(f"/api/applications/{app_id}/experiments", json=experiment).status_code == 201
    )
    assert (
        client.post(
            f"/api/applications/{app_id}/experiments", json={**experiment, "model": "changed"}
        ).status_code
        == 409
    )
    now = int(time.time() * 1000)
    grant = {
        "id": str(uuid4()),
        "source": "synthetic",
        "expiresAt": now + 60000,
        "policy": "metadata-v1",
    }
    trace = {
        "schemaVersion": 1,
        "id": str(uuid4()),
        "experimentId": experiment["id"],
        "grantId": grant["id"],
        "source": "synthetic",
        "policy": "metadata-v1",
        "caseId": None,
        "startedAt": now,
        "endedAt": now + 10,
        "status": "ok",
        "metrics": {"latency_ms": 10},
        "checks": {"passed": True},
    }
    # Same app instance, a separate SDK client: no browser cookies/Origin.
    with TestClient(app, base_url=ORIGIN) as sdk:

        def token(scope):
            sdk.headers["authorization"] = "Bearer " + issued[scope]["token"]

        token("traces:write")
        assert sdk.post("/v1/traces", json=trace).status_code == 403
        assert sdk.post("/v1/grants", json=grant).status_code == 403
        assert sdk.get("/api/catalog").status_code == 403
        assert sdk.post("/api/evaluations", json={}).status_code == 403
        token("grants:write")
        assert sdk.post("/v1/grants", json=grant).status_code == 201
        assert (
            sdk.post(
                "/v1/grants", json={**grant, "id": str(uuid4()), "source": "production"}
            ).status_code
            == 403
        )
        token("traces:write")
        assert sdk.post("/v1/traces", json={**trace, "raw": "private"}).status_code == 422
        assert sdk.post("/v1/traces", json={**trace, "metrics": {"secret": 1}}).status_code == 400
        assert sdk.post("/v1/traces", json=trace).status_code == 201
        assert sdk.get("/v1/traces/" + trace["id"]).status_code == 403
        token("traces:read")
        assert sdk.get("/v1/traces/" + trace["id"]).json() == trace
        assert client.get(f"/api/applications/{app_id}/traces").json() == [trace]
        assert client.get(f"/api/applications/{other_id}/traces").json() == []
        token("grants:write")
        assert sdk.delete("/v1/grants/" + grant["id"]).status_code == 200
        assert sdk.post("/v1/grants", json=grant).status_code == 409
        token("traces:read")
        assert sdk.get("/v1/traces/" + trace["id"]).status_code == 404
        token("traces:write")
        assert sdk.post("/v1/traces", json=trace).status_code == 403
        old = issued["traces:write"]
        replacement = client.post(f"/api/applications/{app_id}/keys/{old['id']}/rotate").json()
        assert sdk.post("/v1/traces", json=trace).status_code == 401
        sdk.headers["authorization"] = "Bearer " + replacement["token"]
        assert sdk.post("/v1/traces", json=trace).status_code == 403  # valid key, withdrawn consent
    app.state.settings.operator_allowlist[SUBJECT] = {
        "email": EMAIL,
        "role": "viewer",
        "resources": [app_id],
    }
    assert client.get("/api/catalog").status_code == 403
    assert client.get(f"/api/applications/{app_id}/traces").status_code == 200
    assert client.get(f"/api/applications/{other_id}/traces").status_code == 403
    assert (
        client.post(f"/api/applications/{app_id}/keys", json={"scope": "traces:read"}).status_code
        == 403
    )


def test_signing_key_rotation_refreshes_without_accepting_old_key(hosted, monkeypatch):
    _, app, _, private, claims = hosted
    auth = app.state.hosted_auth
    auth.jwks = jwt.PyJWKClient(
        auth.settings.supabase_url + "/auth/v1/.well-known/jwks.json", lifespan=60
    )
    current = {"kid": "first", "key": private}

    def fetch():
        import json

        value = {
            "keys": [
                {
                    **json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(current["key"].public_key())),
                    "kid": current["kid"],
                    "use": "sig",
                    "alg": "RS256",
                }
            ]
        }
        auth.jwks.jwk_set_cache.put(value)
        return value

    monkeypatch.setattr(auth.jwks, "fetch_data", fetch)
    first = jwt.encode(claims, private, algorithm="RS256", headers={"kid": "first"})
    assert auth.verify_token(first)[0]["subject"] == SUBJECT
    second = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    current.update(kid="second", key=second)
    auth.jwks.jwk_set_cache.put(None)  # next fetch after bounded cache expiry
    token = jwt.encode(claims, second, algorithm="RS256", headers={"kid": "second"})
    assert auth.verify_token(token)[0]["subject"] == SUBJECT
    from fastapi import HTTPException

    with pytest.raises(HTTPException):
        auth.verify_token(first)


def test_finalized_feed_comparison_and_expired_key(hosted):
    client, app, _, _, _ = hosted
    login(client)
    app_id = str(uuid4())
    assert (
        client.post(
            "/api/applications",
            json={
                "id": app_id,
                "name": "Comparison",
                "environment": "preview",
                "policy": {"metrics": [], "checks": ["passed"]},
                "retention_days": 1,
            },
        ).status_code
        == 201
    )
    base = f"/api/applications/{app_id}"
    dataset = {"schemaVersion": 1, "caseIds": ["a" * 64], "rubricHash": "b" * 64}
    dataset_hash = client.post(base + "/datasets", json=dataset).json()["hash"]
    ids = [str(uuid4()), str(uuid4())]
    for id in ids:
        assert (
            client.post(
                base + "/experiments",
                json={
                    "id": id,
                    "revision": "c" * 40,
                    "promptHash": "d" * 64,
                    "configHash": "e" * 64,
                    "graphHash": None,
                    "model": "mock",
                    "mode": "scripted",
                    "datasetHash": dataset_hash,
                },
            ).status_code
            == 201
        )
    keys = {
        scope: client.post(base + "/keys", json={"scope": scope}).json()
        for scope in ["traces:write", "grants:write", "traces:read"]
    }
    assert client.get(base + f"/comparisons/{ids[0]}/{ids[1]}").status_code == 409
    now = int(time.time() * 1000)
    grant = {
        "id": str(uuid4()),
        "source": "synthetic",
        "expiresAt": now + 60000,
        "policy": "metadata-v1",
    }
    with TestClient(app, base_url=ORIGIN) as sdk:
        sdk.headers["authorization"] = "Bearer " + keys["grants:write"]["token"]
        assert sdk.post("/v1/grants", json=grant).status_code == 201
        sdk.headers["authorization"] = "Bearer " + keys["traces:write"]["token"]
        for index, experiment in enumerate(ids):
            trace = {
                "schemaVersion": 1,
                "id": str(uuid4()),
                "experimentId": experiment,
                "grantId": grant["id"],
                "source": "synthetic",
                "policy": "metadata-v1",
                "caseId": "a" * 64,
                "startedAt": now,
                "endedAt": now,
                "status": "ok",
                "metrics": {},
                "checks": {"passed": bool(index)},
            }
            assert sdk.post("/v1/traces", json={**trace, "caseId": "f" * 64}).status_code == 409
            assert sdk.post("/v1/traces", json=trace).status_code == 201
        sdk.headers["authorization"] = "Bearer " + keys["traces:read"]["token"]
        result = sdk.get(f"/v1/comparisons/{ids[0]}/{ids[1]}")
        assert result.status_code == 200
        assert result.json()["cases"][0]["checks"] == [
            {"name": "passed", "before": False, "after": True}
        ]
        # Duplicate evidence is not silently averaged or selected.
        sdk.headers["authorization"] = "Bearer " + keys["traces:write"]["token"]
        assert sdk.post("/v1/traces", json={**trace, "id": str(uuid4())}).status_code == 201
        assert client.get(base + f"/comparisons/{ids[0]}/{ids[1]}").status_code == 409
        with app.state.session_factory() as session:
            key = session.get(ApplicationKeyRecord, keys["traces:write"]["id"])
            key.expires = time.time() - 1
            session.commit()
        assert sdk.post("/v1/traces", json=trace).status_code == 401
    # A fresh process/composition reads the durable session and observations.
    restarted = create_application(
        settings=app.state.settings,
        session_factory=app.state.session_factory,
        initialize_database=False,
        seed_on_start=False,
    )
    with TestClient(restarted, base_url=ORIGIN) as fresh:
        fresh.cookies.set(COOKIE, client.cookies.get(COOKIE))
        assert len(fresh.get(base + "/traces").json()) == 3


def test_opt_in_registration_is_pending_until_explicit_allowlist_approval(hosted):
    client, app, calls, _, _ = hosted
    assert app.state.settings.allow_self_registration is False
    app.state.settings.operator_allowlist = {}
    body = {"email": EMAIL, "token": "123456"}
    headers = {"origin": ORIGIN}
    assert client.post("/api/auth/verify", json=body, headers=headers).status_code == 401
    app.state.settings.allow_self_registration = True
    assert (
        client.post("/api/auth/request", json={"email": EMAIL}, headers=headers).status_code == 200
    )
    assert calls[-1][1] == {"email": EMAIL, "create_user": True}
    result = client.post("/api/auth/verify", json=body, headers=headers)
    assert result.json() == {"authenticated": False, "status": "pending", "subject": SUBJECT}
    assert not client.cookies.get(COOKIE)
    with app.state.session_factory() as session:
        assert session.scalars(select(HostedSessionRecord)).all() == []
    for path in [
        "/api/auth/session",
        "/api/catalog",
        "/api/applications",
        "/api/traces",
        "/v1/traces/any",
        "/openapi.json",
    ]:
        assert client.get(path).status_code == 401
    assert client.post("/api/applications", json={}, headers=headers).status_code == 401
    # The identity provider and its metadata do not assign application roles.
    app.state.settings.operator_allowlist = {
        SUBJECT: {"email": "other@example.invalid", "role": "admin"}
    }
    assert client.post("/api/auth/verify", json=body, headers=headers).json()["status"] == "pending"
    app.state.settings.operator_allowlist = {SUBJECT: {"email": EMAIL, "role": "admin"}}
    login(client)
    assert client.get("/api/catalog").status_code == 200
    cookie = client.cookies.get(COOKIE)
    app.state.settings.operator_allowlist = {}
    assert client.get("/api/catalog").status_code == 401
    assert client.post("/api/auth/verify", json=body, headers=headers).json()["status"] == "pending"
    assert not client.cookies.get(COOKIE)
    with app.state.session_factory() as session:
        assert session.get(HostedSessionRecord, digest(cookie)) is None


def test_pending_registration_still_requires_verified_identity_and_numeric_otp(hosted, monkeypatch):
    client, app, _, _, _ = hosted
    app.state.settings.allow_self_registration = True
    app.state.settings.operator_allowlist = {}
    body = {"email": EMAIL, "token": "123456"}
    assert client.post("/api/auth/verify", json=body).status_code == 403
    headers = {"origin": ORIGIN}
    assert (
        client.post(
            "/api/auth/verify", json={**body, "token": "magic-link"}, headers=headers
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/auth/verify", json={**body, "token": "000000"}, headers=headers
        ).status_code
        == 401
    )
    for change in [
        {"email_confirmed_at": None},
        {"id": str(uuid4())},
        {"email": "other@example.invalid"},
    ]:
        monkeypatch.setattr(
            "autoeval_api.services.hosted_auth.httpx.get",
            lambda *a, change=change, **k: httpx.Response(
                200,
                json={"id": SUBJECT, "email": EMAIL, "email_confirmed_at": "2026-01-01", **change},
            ),
        )
        result = client.post("/api/auth/verify", json=body, headers=headers)
        assert result.status_code == 401
        assert "subject" not in result.json()
