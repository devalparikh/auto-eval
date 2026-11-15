import contextlib
import threading
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
from autoeval_api.models import HostedSessionRecord
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


def test_hosted_service_prefix_preserves_authorization(hosted):
    from autoeval_api.api.middleware import HostedPrefixMiddleware

    _, app, _, _, _ = hosted
    with TestClient(HostedPrefixMiddleware(app), base_url=ORIGIN) as client:
        assert client.get("/api/backend/api/health").status_code == 200
        assert client.get("/api/backend/api/auth/bootstrap").json() == {"mode": "supabase"}
        for prefix in ["", "/api/backend"]:
            for path in ["/api/catalog", "/api/applications", "/api/auth/session"]:
                assert client.get(prefix + path).status_code == 401
        result = client.post(
            "/api/backend/api/auth/verify",
            json={"email": EMAIL, "token": "123456"},
            headers={"origin": ORIGIN},
        )
        assert result.status_code == 200
        assert client.get("/api/backend/api/catalog").status_code == 200
        app.state.settings.operator_allowlist = {}
        assert client.get("/api/backend/api/catalog").status_code == 401
        app.state.settings.allow_self_registration = True
        result = client.post(
            "/api/backend/api/auth/verify",
            json={"email": EMAIL, "token": "123456"},
            headers={"origin": ORIGIN},
        )
        assert result.json() == {"authenticated": False, "status": "pending", "subject": SUBJECT}
        assert client.get("/api/backend/api/applications").status_code == 401


def test_email_link_mode_is_opt_in_and_requires_browser_proof(hosted):
    client, app, calls, _, _ = hosted
    assert app.state.settings.allow_email_link_sign_in is False
    body = {"code": "a" * 36}
    assert (
        client.post("/api/auth/exchange", json=body, headers={"origin": ORIGIN}).status_code == 404
    )
    app.state.settings.allow_email_link_sign_in = True
    assert client.post("/api/auth/exchange", json=body).status_code == 403
    assert (
        client.post("/api/auth/exchange", json=body, headers={"origin": ORIGIN}).status_code == 403
    )
    assert calls == []


def test_pkce_link_pending_approval_and_same_browser_binding(hosted, monkeypatch):
    import base64
    import hashlib

    from autoeval_api.api.routes.auth import PKCE_COOKIE

    client, app, _, private, claims = hosted
    app.state.settings.allow_email_link_sign_in = True
    app.state.settings.allow_self_registration = True
    app.state.settings.operator_allowlist = {}
    issued = {}
    verified_calls = []

    def provider(url, **kwargs):
        payload = kwargs["json"]
        if url.endswith("/otp"):
            assert kwargs["params"] == {"redirect_to": ORIGIN + "/"}
            assert payload["create_user"] is True
            assert payload["code_challenge_method"] == "s256"
            issued["challenge"] = payload["code_challenge"]
            issued["used"] = False
            return httpx.Response(200, json={})
        assert url == "https://auth.example.invalid/auth/v1/token"
        assert kwargs["params"] == {"grant_type": "pkce"}
        verified_calls.append(payload)
        expected = (
            base64.urlsafe_b64encode(hashlib.sha256(payload["code_verifier"].encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        if issued["used"] or expected != issued["challenge"] or payload["auth_code"] != "a" * 36:
            return httpx.Response(400, json={})
        issued["used"] = True
        token = jwt.encode(claims, private, algorithm="RS256", headers={"kid": "test"})
        return httpx.Response(200, json={"access_token": token, "refresh_token": "never-persist"})

    monkeypatch.setattr("autoeval_api.api.routes.auth.httpx.post", provider)
    headers = {"origin": ORIGIN}
    response = client.post("/api/auth/request", json={"email": EMAIL}, headers=headers)
    assert response.status_code == 200
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "Secure" in response.headers["set-cookie"]
    assert "SameSite=lax" in response.headers["set-cookie"]
    assert "Max-Age=600" in response.headers["set-cookie"]
    verifier = client.cookies.get(PKCE_COOKIE)
    body = {"code": "a" * 36}
    client.cookies.clear()
    assert client.post("/api/auth/exchange", json=body, headers=headers).status_code == 403
    assert verified_calls == []
    client.cookies.set(PKCE_COOKIE, "b" * 43)
    assert client.post("/api/auth/exchange", json=body, headers=headers).status_code == 401
    client.cookies.clear()
    client.cookies.set(PKCE_COOKIE, verifier, domain="testserver.local", path="/")
    response = client.post("/api/auth/exchange", json=body, headers=headers)
    assert response.json() == {"authenticated": False, "status": "pending", "subject": SUBJECT}
    assert "Max-Age=0" in response.headers["set-cookie"]
    assert client.get("/api/catalog").status_code == 401
    # The link path persists the same display-only pending record as numeric OTP.
    assert "HttpOnly" in pending_cookie_header(response)
    status = client.post("/api/auth/pending", headers=headers)
    assert status.json() == {"authenticated": False, "status": "pending", "subject": SUBJECT}
    assert client.get("/api/auth/session").status_code == 401
    with app.state.session_factory() as session:
        assert list(session.scalars(select(HostedSessionRecord))) == []
    client.cookies.clear()
    client.cookies.set(PKCE_COOKIE, verifier)
    assert client.post("/api/auth/exchange", json=body, headers=headers).status_code == 401
    # A separately approved UUID/email may get the same opaque session as OTP.
    client.cookies.clear()
    app.state.settings.operator_allowlist = {SUBJECT: {"email": EMAIL, "role": "admin"}}
    client.post("/api/auth/request", json={"email": EMAIL}, headers=headers)
    response = client.post("/api/auth/exchange", json=body, headers=headers)
    assert response.json() == {"authenticated": True}
    assert client.get("/api/catalog").status_code == 200
    assert "refresh_token" not in response.text and "access_token" not in response.text
    app.state.settings.operator_allowlist = {}
    assert client.get("/api/catalog").status_code == 401


def test_pkce_exchange_still_rejects_wrong_jwt_and_unverified_email(hosted, monkeypatch):
    from autoeval_api.api.routes.auth import PKCE_COOKIE

    client, app, _, private, claims = hosted
    app.state.settings.allow_email_link_sign_in = True
    app.state.settings.allow_self_registration = True
    app.state.settings.operator_allowlist = {}
    client.cookies.set(PKCE_COOKIE, "a" * 43)
    token = jwt.encode(
        {**claims, "iss": "https://other.invalid/auth/v1"}, private, algorithm="RS256"
    )
    monkeypatch.setattr(
        "autoeval_api.api.routes.auth.httpx.post",
        lambda *a, **k: httpx.Response(200, json={"access_token": token}),
    )
    body = {"code": "a" * 36}
    assert (
        client.post("/api/auth/exchange", json=body, headers={"origin": ORIGIN}).status_code == 401
    )
    token = jwt.encode(claims, private, algorithm="RS256")
    monkeypatch.setattr(
        "autoeval_api.services.hosted_auth.httpx.get",
        lambda *a, **k: httpx.Response(
            200, json={"id": SUBJECT, "email": EMAIL, "email_confirmed_at": None}
        ),
    )
    assert (
        client.post("/api/auth/exchange", json=body, headers={"origin": ORIGIN}).status_code == 401
    )
    with app.state.session_factory() as session:
        assert list(session.scalars(select(HostedSessionRecord))) == []


def pending_cookie_header(response):
    from autoeval_api.services.hosted_auth import PENDING_COOKIE

    headers = [
        value
        for value in response.headers.get_list("set-cookie")
        if value.startswith(PENDING_COOKIE + "=")
    ]
    assert len(headers) == 1, response.headers.get_list("set-cookie")
    return headers[0]


def test_pending_registration_survives_reload_without_granting_access(hosted):
    from autoeval_api.models import HostedPendingRecord
    from autoeval_api.services.hosted_auth import PENDING_COOKIE

    client, app, _, _, _ = hosted
    app.state.settings.allow_self_registration = True
    app.state.settings.operator_allowlist = {}
    headers = {"origin": ORIGIN}
    body = {"email": EMAIL, "token": "123456"}
    result = client.post("/api/auth/verify", json=body, headers=headers)
    assert result.json() == {"authenticated": False, "status": "pending", "subject": SUBJECT}
    cookie = pending_cookie_header(result)
    for attribute in ["HttpOnly", "Secure", "SameSite=strict", "Path=/"]:
        assert attribute in cookie
    # Bounded by the verified token's own expiry (600s in this fixture).
    max_age = int(cookie.split("Max-Age=")[1].split(";")[0])
    assert 0 < max_age <= 600
    pending = client.cookies.get(PENDING_COOKIE)
    assert pending and not client.cookies.get(COOKIE)
    with app.state.session_factory() as session:
        assert session.scalars(select(HostedSessionRecord)).all() == []
        (row,) = session.scalars(select(HostedPendingRecord)).all()
        assert row.digest == digest(pending) and row.digest != pending

    # A reload asks the server, which reports only this browser's verified subject.
    assert client.post("/api/auth/pending").status_code == 403
    status = client.post("/api/auth/pending", headers=headers)
    assert status.json() == {"authenticated": False, "status": "pending", "subject": SUBJECT}
    assert "set-cookie" not in status.headers

    # The pending cookie authorizes nothing, under either cookie name.
    for value in [None, pending]:
        if value:
            client.cookies.set(COOKIE, value)
        for path in ["/api/auth/session", "/api/catalog", "/api/applications", "/api/traces"]:
            assert client.get(path, headers=headers).status_code == 401
        assert client.post("/api/applications", json={}, headers=headers).status_code == 401
        assert client.post("/api/auth/logout", headers=headers).status_code == 401
    client.cookies.delete(COOKIE)

    # Another browser, or a guessed value, learns nothing.
    with TestClient(app, base_url=ORIGIN) as other:
        assert other.post("/api/auth/pending", headers=headers).json() == {"authenticated": False}
        other.cookies.set(PENDING_COOKIE, "x" * 43)
        assert other.post("/api/auth/pending", headers=headers).json() == {"authenticated": False}

    # Approval of a different email is not approval of this identity.
    app.state.settings.operator_allowlist = {
        SUBJECT: {"email": "other@example.invalid", "role": "admin"}
    }
    assert client.post("/api/auth/pending", headers=headers).json()["status"] == "pending"
    # Exact approval ends the pending record but still requires a fresh sign-in.
    app.state.settings.operator_allowlist = {SUBJECT: {"email": EMAIL, "role": "admin"}}
    approved = client.post("/api/auth/pending", headers=headers)
    assert approved.json() == {"authenticated": False, "status": "approved"}
    assert "Max-Age=0" in pending_cookie_header(approved)
    assert not client.cookies.get(COOKIE) and not client.cookies.get(PENDING_COOKIE)
    assert client.get("/api/catalog").status_code == 401
    client.cookies.set(PENDING_COOKIE, pending)
    assert client.post("/api/auth/pending", headers=headers).json() == {"authenticated": False}
    with app.state.session_factory() as session:
        assert session.scalars(select(HostedPendingRecord)).all() == []
    login(client)
    assert client.get("/api/catalog").status_code == 200


def test_pending_record_expires_is_cleared_and_is_one_per_subject(hosted):
    from sqlalchemy import update

    from autoeval_api.models import HostedPendingRecord
    from autoeval_api.services.hosted_auth import PENDING_COOKIE

    client, app, _, _, _ = hosted
    app.state.settings.allow_self_registration = True
    app.state.settings.operator_allowlist = {}
    headers = {"origin": ORIGIN}
    body = {"email": EMAIL, "token": "123456"}

    def verify(browser):
        result = browser.post("/api/auth/verify", json=body, headers=headers)
        assert result.json()["status"] == "pending"
        return browser.cookies.get(PENDING_COOKIE)

    def rows():
        with app.state.session_factory() as session:
            return session.scalars(select(HostedPendingRecord)).all()

    # Expiry: a record past its bound is removed and reports nothing.
    first = verify(client)
    with app.state.session_factory() as session:
        session.execute(update(HostedPendingRecord).values(expires=time.time() - 1))
        session.commit()
    assert client.post("/api/auth/pending", headers=headers).json() == {"authenticated": False}
    assert rows() == []

    # One record per subject: a newer verification replaces the older one.
    first = verify(client)
    with TestClient(app, base_url=ORIGIN) as other:
        second = verify(other)
        assert other.post("/api/auth/pending", headers=headers).json()["status"] == "pending"
    assert [row.digest for row in rows()] == [digest(second)]
    assert client.post("/api/auth/pending", headers=headers).json() == {"authenticated": False}

    # Re-verifying in the same browser replaces its own record.
    first = verify(client)
    again = verify(client)
    assert first != again and [row.digest for row in rows()] == [digest(again)]

    # Disabling registration ends pending display without granting anything.
    app.state.settings.allow_self_registration = False
    assert client.post("/api/auth/pending", headers=headers).json() == {"authenticated": False}
    assert rows() == []

    # Explicit clear: requires the allowed origin, removes the record and cookie.
    app.state.settings.allow_self_registration = True
    verify(client)
    assert client.delete("/api/auth/pending").status_code == 403
    cleared = client.delete("/api/auth/pending", headers=headers)
    assert cleared.status_code == 200 and "Max-Age=0" in pending_cookie_header(cleared)
    assert rows() == [] and not client.cookies.get(PENDING_COOKIE)

    # An approved sign-in in this browser clears its pending record too.
    verify(client)
    app.state.settings.operator_allowlist = {SUBJECT: {"email": EMAIL, "role": "admin"}}
    result = client.post("/api/auth/verify", json=body, headers=headers)
    assert result.json() == {"authenticated": True}
    assert "Max-Age=0" in pending_cookie_header(result)
    assert rows() == [] and not client.cookies.get(PENDING_COOKIE)
    # And sign-out clears both, whatever the browser still presents.
    client.cookies.set(PENDING_COOKIE, "y" * 43)
    client.headers["origin"] = ORIGIN
    logout = client.post("/api/auth/logout")
    assert logout.status_code == 200 and "Max-Age=0" in pending_cookie_header(logout)


def test_pending_status_requires_hosted_mode_and_no_failed_verification_leaves_a_record(
    hosted, monkeypatch
):
    from autoeval_api.models import HostedPendingRecord
    from autoeval_api.services.hosted_auth import PENDING_COOKIE

    client, app, _, _, _ = hosted
    app.state.settings.allow_self_registration = True
    app.state.settings.operator_allowlist = {}
    headers = {"origin": ORIGIN}
    body = {"email": EMAIL, "token": "123456"}
    assert (
        client.post("/api/auth/verify", json={**body, "token": "000000"}, headers=headers)
    ).status_code == 401
    monkeypatch.setattr(
        "autoeval_api.services.hosted_auth.httpx.get",
        lambda *a, **k: httpx.Response(
            200, json={"id": SUBJECT, "email": EMAIL, "email_confirmed_at": None}
        ),
    )
    assert client.post("/api/auth/verify", json=body, headers=headers).status_code == 401
    assert not client.cookies.get(PENDING_COOKIE)
    with app.state.session_factory() as session:
        assert session.scalars(select(HostedPendingRecord)).all() == []
    app.state.settings.auth_mode = "none"
    assert client.post("/api/auth/pending", headers=headers).status_code == 404


def test_signed_out_pending_checks_do_not_spend_the_sign_in_budget(hosted):
    from autoeval_api.services.hosted_auth import PENDING_COOKIE

    client, app, _, _, _ = hosted
    app.state.settings.allow_self_registration = True
    headers = {"origin": ORIGIN}
    # Well past both the per-client (20) and global (100) auth limits per minute.
    for _ in range(110):
        result = client.post("/api/auth/pending", headers=headers)
        assert result.json() == {"authenticated": False}
    assert client.post("/api/auth/pending").status_code == 403
    assert (
        client.post("/api/auth/request", json={"email": EMAIL}, headers=headers).status_code == 200
    )
    # A presented cookie, even a guessed one, is looked up and therefore limited.
    client.cookies.set(PENDING_COOKIE, "z" * 43)
    codes = {client.post("/api/auth/pending", headers=headers).status_code for _ in range(25)}
    assert codes == {200, 429}


@pytest.mark.parametrize("database", ["postgres", "sqlite-file"])
def test_concurrent_pending_verifications_leave_exactly_one_valid_record(
    request, tmp_path, database
):
    """PostgreSQL READ COMMITTED interleaving: both writers act before either commits.

    A delete-then-insert replacement lets each transaction miss the other's
    uncommitted row, leaving two valid pending cookies for one subject. The
    database key must make the second writer wait and replace the first. SQLite
    serializes writers, so there it only proves the same path stays correct.
    """
    from sqlalchemy import create_engine

    if database == "postgres":
        engine = request.getfixturevalue("postgres")
    else:
        engine = create_engine(f"sqlite:///{tmp_path}/pending.db")

    from autoeval_api.models import HostedPendingRecord
    from autoeval_api.services.hosted_auth import HostedAuth

    upgrade(engine)
    factory = build_session_factory(engine)
    settings = Settings(
        AUTOEVAL_ENV="test",
        auth_mode="supabase",
        supabase_url="https://auth.example.invalid",
        supabase_publishable_key="test-publishable",
        allow_self_registration=True,
        allowed_hosts=["testserver"],
        web_origins=[ORIGIN],
    )
    # Hold every commit until both verifications have written (or one is
    # blocked by the other's row), so the interleaving is not left to chance.
    both_written = threading.Barrier(2)

    def interleaved():
        session = factory()
        commit = session.commit

        def held_commit():
            with contextlib.suppress(threading.BrokenBarrierError):
                both_written.wait(timeout=3)
            commit()

        session.commit = held_commit
        return session

    auth = HostedAuth(settings, interleaved)
    auth.verify_token = lambda token, allow_pending: (
        {"subject": SUBJECT, "email": EMAIL, "role": "pending"},
        time.time() + 600,
    )
    values, errors = [], []

    def verify():
        try:
            values.append(auth.new_session("token")[0])
        except Exception as error:  # surfaced below
            errors.append(error)

    threads = [threading.Thread(target=verify) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert errors == [] and len(values) == 2 and values[0] != values[1]
    with factory() as session:
        rows = session.scalars(select(HostedPendingRecord)).all()
    assert [row.subject for row in rows] == [SUBJECT]
    valid = [value for value in values if auth.pending_status(value) is not None]
    assert len(valid) == 1 and rows[0].digest == digest(valid[0])
