import contextlib

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from autoeval_api.models import HostedSessionRecord
from autoeval_api.services.hosted_auth import COOKIE, digest, rate_limit

router = APIRouter(prefix="/api/auth", tags=["auth"])


class EmailRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=320, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class VerifyRequest(EmailRequest):
    token: str = Field(pattern=r"^[0-9]{6,10}$")


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
def request_code(body: EmailRequest, request: Request) -> dict:
    require_hosted(request)
    settings = request.app.state.settings
    rate_limit(request.app.state.session_factory, "email:" + body.email.lower(), 3, 300)
    # Same result for unknown emails and provider failures. The provider is also
    # asked for unapproved emails, avoiding a local allowlist timing oracle.
    with contextlib.suppress(httpx.HTTPError):
        httpx.post(
            settings.supabase_url + "/auth/v1/otp",
            headers={"apikey": settings.supabase_publishable_key.get_secret_value()},
            json={"email": body.email, "create_user": settings.allow_self_registration},
            timeout=5,
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
        value, age, pending_subject = request.app.state.hosted_auth.new_session(
            result.json()["access_token"]
        )
    except (httpx.HTTPError, ValueError, KeyError):
        raise HTTPException(401, "Code could not be verified") from None
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
