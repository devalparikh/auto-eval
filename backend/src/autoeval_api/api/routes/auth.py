import base64
import contextlib
import hashlib
import re
import secrets

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from autoeval_api.models import HostedSessionRecord
from autoeval_api.services.hosted_auth import COOKIE, digest, rate_limit

router = APIRouter(prefix="/api/auth", tags=["auth"])
PKCE_COOKIE = "__Host-autoeval-pkce"


class EmailRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=320, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class VerifyRequest(EmailRequest):
    token: str = Field(pattern=r"^[0-9]{6,10}$")


class ExchangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(pattern=r"^[A-Za-z0-9_-]{16,256}$")


def require_hosted(request):
    if request.app.state.settings.auth_mode != "supabase":
        raise HTTPException(404, "Not available")
    # Login CSRF matters even before a session exists.
    if request.headers.get("origin") not in request.app.state.settings.web_origins:
        raise HTTPException(403, "Request not authorized")
    rate_limit(request.app.state.session_factory, "auth-global", 100, 60)
    rate_limit(request.app.state.session_factory, "auth-client:" + request.client.host, 20, 60)


@router.get("/bootstrap")
def bootstrap(request: Request) -> dict:
    return {"mode": request.app.state.settings.auth_mode}


@router.get("/session")
def session(request: Request) -> dict:
    return getattr(request.state, "principal", {"role": "admin"})


@router.post("/request")
def request_code(body: EmailRequest, request: Request, response: Response) -> dict:
    require_hosted(request)
    settings = request.app.state.settings
    rate_limit(request.app.state.session_factory, "email:" + body.email.lower(), 3, 300)
    payload = {"email": body.email, "create_user": settings.allow_self_registration}
    options = {}
    if settings.allow_email_link_sign_in:
        verifier = secrets.token_urlsafe(32)
        payload.update(
            {
                "code_challenge": base64.urlsafe_b64encode(
                    hashlib.sha256(verifier.encode()).digest()
                )
                .rstrip(b"=")
                .decode(),
                "code_challenge_method": "s256",
            }
        )
        # Origin was checked above; callers cannot choose an external redirect.
        options["params"] = {"redirect_to": request.headers["origin"] + "/"}
        response.set_cookie(
            PKCE_COOKIE,
            verifier,
            max_age=600,
            secure=True,
            httponly=True,
            samesite="lax",
            path="/",
        )
    # Same result for unknown emails and provider failures. The provider is also
    # asked for unapproved emails, avoiding a local allowlist timing oracle.
    with contextlib.suppress(httpx.HTTPError):
        httpx.post(
            settings.supabase_url + "/auth/v1/otp",
            headers={"apikey": settings.supabase_publishable_key.get_secret_value()},
            json=payload,
            timeout=5,
            **options,
        )
    return {"message": "If email delivery is available, a code will arrive shortly."}


@router.post("/verify")
def verify(body: VerifyRequest, request: Request, response: Response) -> dict:
    require_hosted(request)
    settings = request.app.state.settings
    rate_limit(request.app.state.session_factory, "verify:" + body.email.lower(), 10, 300)
    try:
        result = httpx.post(
            settings.supabase_url + "/auth/v1/verify",
            headers={"apikey": settings.supabase_publishable_key.get_secret_value()},
            json={"email": body.email, "token": body.token, "type": "email"},
            timeout=5,
        )
        if result.status_code != 200:
            raise ValueError()
        access_token = result.json()["access_token"]
    except (httpx.HTTPError, ValueError, KeyError):
        raise HTTPException(401, "Code could not be verified") from None
    return complete_verification(request, response, access_token)


@router.post("/exchange")
def exchange(body: ExchangeRequest, request: Request, response: Response) -> dict:
    settings = request.app.state.settings
    if not settings.allow_email_link_sign_in:
        raise HTTPException(404, "Not available")
    require_hosted(request)
    verifier = request.cookies.get(PKCE_COOKIE, "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", verifier):
        raise HTTPException(403, "Request not authorized")
    try:
        result = httpx.post(
            settings.supabase_url + "/auth/v1/token",
            params={"grant_type": "pkce"},
            headers={"apikey": settings.supabase_publishable_key.get_secret_value()},
            json={"auth_code": body.code, "code_verifier": verifier},
            timeout=5,
        )
        if result.status_code != 200:
            raise ValueError()
        access_token = result.json()["access_token"]
    except (httpx.HTTPError, ValueError, KeyError):
        raise HTTPException(401, "Link could not be verified") from None
    # Supabase validates the one-use code + verifier. Reuse the same verified
    # issuer/audience/current-email and explicit allowlist checks as numeric OTP.
    verified = complete_verification(request, response, access_token)
    response.delete_cookie(PKCE_COOKIE, secure=True, httponly=True, samesite="lax", path="/")
    return verified


def complete_verification(request: Request, response: Response, access_token: str) -> dict:
    value, age, pending_subject = request.app.state.hosted_auth.new_session(access_token)
    if pending_subject is not None:
        # Clear any previous browser identity; verification alone grants no access.
        with request.app.state.session_factory() as session:
            row = session.get(HostedSessionRecord, digest(request.cookies.get(COOKIE, "")))
            if row:
                session.delete(row)
                session.commit()
        response.delete_cookie(COOKIE, secure=True, httponly=True, samesite="strict", path="/")
        return {"authenticated": False, "status": "pending", "subject": pending_subject}
    response.set_cookie(
        COOKIE, value, max_age=age, secure=True, httponly=True, samesite="strict", path="/"
    )
    return {"authenticated": True}


@router.post("/logout")
def logout(request: Request, response: Response) -> dict:
    with request.app.state.session_factory() as session:
        row = session.get(HostedSessionRecord, digest(request.cookies.get(COOKIE, "")))
        if row:
            session.delete(row)
            session.commit()
    response.delete_cookie(COOKIE, secure=True, httponly=True, samesite="strict", path="/")
    return {"authenticated": False}
