"""Hosted identities, opaque sessions, and durable rate limits. Never log credentials."""

import hashlib
import secrets
import time
from uuid import UUID

import httpx
import jwt
from fastapi import HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from autoeval_api.models import ApplicationKeyRecord, HostedRateRecord, HostedSessionRecord

COOKIE = "__Host-autoeval"
PUBLIC = {
    "/api/health",
    "/api/auth/bootstrap",
    "/api/auth/request",
    "/api/auth/verify",
    "/api/auth/exchange",
}


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def denied(status=401):
    raise HTTPException(status, "Request not authorized")


def rate_limit(factory, identity, limit=20, window=60):
    now = time.time()
    key = digest(f"{identity}:{int(now // window)}")
    with factory() as session:
        session.execute(delete(HostedRateRecord).where(HostedRateRecord.expires < now))
        insert = pg_insert if session.bind.dialect.name == "postgresql" else sqlite_insert
        session.execute(
            insert(HostedRateRecord)
            .values(digest=key, count=0, expires=now + window)
            .on_conflict_do_nothing()
        )
        count = session.execute(
            update(HostedRateRecord)
            .where(HostedRateRecord.digest == key)
            .values(count=HostedRateRecord.count + 1)
            .returning(HostedRateRecord.count)
        ).scalar_one()
        session.commit()
    if count > limit:
        raise HTTPException(429, "Try again later")


class HostedAuth:
    def __init__(self, settings, factory):
        self.settings, self.factory = settings, factory
        self.jwks = (
            jwt.PyJWKClient(
                settings.supabase_url + "/auth/v1/.well-known/jwks.json", lifespan=60, timeout=5
            )
            if settings.auth_mode == "supabase"
            else None
        )

    def enrollment(self, subject, email):
        entry = self.settings.operator_allowlist.get(subject)
        if not entry or entry["email"].lower() != email.lower():
            denied()
        return {"subject": subject, **entry}

    def verify_token(self, token, *, allow_pending=False):
        try:
            key = self.jwks.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                key.key,
                algorithms=["RS256", "ES256"],
                audience="authenticated",
                issuer=self.settings.supabase_url + "/auth/v1",
                options={"require": ["exp", "iat", "sub", "aud", "iss"]},
            )
            # Auth server checks the current identity, including verified email.
            response = httpx.get(
                self.settings.supabase_url + "/auth/v1/user",
                headers={
                    "apikey": self.settings.supabase_publishable_key.get_secret_value(),
                    "Authorization": f"Bearer {token}",
                },
                timeout=5,
            )
            user = response.json() if response.status_code == 200 else {}
            if (
                not user.get("email_confirmed_at")
                or user.get("id") != claims["sub"]
                or user.get("email") != claims.get("email")
            ):
                denied()
            # Only a verified, canonical subject may be shown to its own caller.
            if str(UUID(claims["sub"])) != claims["sub"]:
                denied()
            entry = self.settings.operator_allowlist.get(claims["sub"])
            if allow_pending and (not entry or entry["email"].lower() != user["email"].lower()):
                principal = {"subject": claims["sub"], "role": "pending"}
            else:
                principal = self.enrollment(claims["sub"], user["email"])
            return principal, min(claims["exp"], time.time() + self.settings.session_seconds)
        except (jwt.PyJWTError, httpx.HTTPError, ValueError, KeyError):
            denied()

    def new_session(self, token):
        principal, expires = self.verify_token(
            token, allow_pending=self.settings.allow_self_registration
        )
        if principal["role"] == "pending":
            # No pending session, role, or database authorization record is created.
            return None, 0, principal["subject"]
        value = secrets.token_urlsafe(32)
        with self.factory() as session:
            session.execute(
                delete(HostedSessionRecord).where(HostedSessionRecord.expires <= time.time())
            )
            session.add(
                HostedSessionRecord(
                    digest=digest(value),
                    subject=principal["subject"],
                    email=principal["email"],
                    expires=expires,
                )
            )
            session.commit()
        return value, max(0, int(expires - time.time())), None

    def authenticate(self, request):
        auth = request.headers.get("authorization", "")
        # App keys are never accepted as human credentials, or vice versa.
        if auth.startswith("Bearer ae_"):
            if request.headers.get("origin") or request.headers.get("sec-fetch-site"):
                denied(403)
            with self.factory() as session:
                key = session.scalar(
                    select(ApplicationKeyRecord).where(
                        ApplicationKeyRecord.digest == digest(auth[7:])
                    )
                )
                if not key or key.revoked or key.expires <= time.time():
                    denied()
                return {"key_id": key.id, "application_id": key.application_id, "scope": key.scope}
        value = request.cookies.get(COOKIE, "")
        with self.factory() as session:
            record = session.get(HostedSessionRecord, digest(value)) if value else None
            if not record or record.expires <= time.time():
                denied()
            principal = self.enrollment(record.subject, record.email)
        if (
            request.method not in {"GET", "HEAD", "OPTIONS"}
            and request.headers.get("origin") not in self.settings.web_origins
        ):
            denied(403)
        return principal

    def authorize(self, request):
        path = request.url.path
        if path in PUBLIC:
            return
        principal = self.authenticate(request)
        request.state.principal = principal
        if "key_id" in principal:
            if not path.startswith("/v1/"):
                denied(403)
        elif path.startswith("/v1/"):
            denied(403)
        elif (
            not path.startswith(("/api/applications", "/api/auth/"))
            and principal["role"] != "admin"
        ):
            # Existing workbench records are an instance-admin resource, never
            # exposed to feed viewers by a broad read-only HTTP rule.
            denied(403)
