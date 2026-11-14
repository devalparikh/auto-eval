from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select

from autoeval_api.models import ApplicationKeyRecord, ApplicationRecord
from autoeval_api.services import application_feed as feed
from autoeval_api.services.hosted_auth import denied, rate_limit

router = APIRouter(tags=["application feed"])


def principal(request):
    # Local authenticated trust boundary is the loopback guard, not an app key.
    return getattr(request.state, "principal", {"role": "admin"})


@router.get("/api/applications")
def applications(request: Request) -> list[dict]:
    user = principal(request)
    with request.app.state.session_factory() as session:
        return [
            {
                "id": app.id,
                "name": app.name,
                "environment": app.environment,
                "policy": app.policy,
                "retention_days": app.retention_days,
            }
            for app in session.scalars(select(ApplicationRecord))
            if user.get("role") == "admin" or app.id in user.get("resources", [])
        ]


@router.post("/api/applications", status_code=201)
def create_application(body: feed.ApplicationInput, request: Request) -> dict:
    if principal(request).get("role") != "admin":
        denied(403)
    with request.app.state.session_factory() as session:
        if session.get(ApplicationRecord, body.id):
            raise HTTPException(409, "Application already exists")
        session.add(ApplicationRecord(**body.model_dump()))
        session.commit()
    return {"id": body.id}


@router.post("/api/applications/{app_id}/keys", status_code=201)
def issue_key(app_id: str, body: feed.KeyInput, request: Request) -> dict:
    with request.app.state.session_factory() as session:
        feed.resource(session, principal(request), app_id, write=True)
        result = feed.issue_key(session, app_id, body)
        session.commit()
        return result


@router.get("/api/applications/{app_id}/keys")
def keys(app_id: str, request: Request) -> list[dict]:
    with request.app.state.session_factory() as session:
        feed.resource(session, principal(request), app_id, write=True)
        return [
            {"id": key.id, "scope": key.scope, "expires": key.expires, "revoked": key.revoked}
            for key in session.scalars(
                select(ApplicationKeyRecord).where(ApplicationKeyRecord.application_id == app_id)
            )
        ]


@router.post("/api/applications/{app_id}/keys/{key_id}/{action}")
def change_key(app_id: str, key_id: str, action: str, request: Request) -> dict:
    with request.app.state.session_factory() as session:
        feed.resource(session, principal(request), app_id, write=True)
        key = session.get(ApplicationKeyRecord, key_id)
        if not key or key.application_id != app_id or action not in {"revoke", "rotate"}:
            raise HTTPException(404, "Key not found")
        if key.revoked and action == "rotate":
            raise HTTPException(409, "Key already revoked")
        key.revoked = True
        result = (
            feed.issue_key(session, app_id, feed.KeyInput(scope=key.scope))
            if action == "rotate"
            else {"revoked": True}
        )
        session.commit()
        return result


@router.post("/api/applications/{app_id}/datasets", status_code=201)
def dataset(app_id: str, body: feed.Dataset, request: Request) -> dict:
    with request.app.state.session_factory() as session:
        app = feed.resource(session, principal(request), app_id, write=True)
        result = feed.save_dataset(session, app, body)
        session.commit()
        return result


@router.post("/api/applications/{app_id}/experiments", status_code=201)
def experiment(app_id: str, body: feed.Experiment, request: Request) -> dict:
    with request.app.state.session_factory() as session:
        app = feed.resource(session, principal(request), app_id, write=True)
        result = feed.save_experiment(session, app, body)
        session.commit()
        return result


@router.get("/api/applications/{app_id}/traces")
def dashboard(app_id: str, request: Request) -> list[dict]:
    with request.app.state.session_factory() as session:
        feed.resource(session, principal(request), app_id)
        feed.purge(session)
        result = feed.observations(session, app_id)
        session.commit()
        return result


def key_principal(request):
    # Keys are required even in local mode. Do not grant local SDKs admin power.
    user = request.app.state.hosted_auth.authenticate(request)
    if "key_id" not in user:
        denied(403)
    rate_limit(request.app.state.session_factory, "key:" + user["key_id"], 120)
    return user


@router.post("/v1/grants", status_code=201)
def grant(body: feed.Grant, request: Request) -> dict:
    user = key_principal(request)
    with request.app.state.session_factory() as session:
        app = feed.key_resource(session, user, "grants:write")
        result = feed.grant(session, app, body, request.app.state.settings.feed_allow_production)
        session.commit()
        return result


@router.delete("/v1/grants/{id}")
def revoke_grant(id: feed.Id, request: Request) -> dict:
    user = key_principal(request)
    with request.app.state.session_factory() as session:
        app = feed.key_resource(session, user, "grants:write")
        result = feed.revoke_grant(session, app, id)
        session.commit()
        return result


@router.post("/v1/traces", status_code=201)
def ingest(body: feed.Observation, request: Request) -> dict:
    user = key_principal(request)
    with request.app.state.session_factory() as session:
        app = feed.key_resource(session, user, "traces:write")
        feed.purge(session)
        result = feed.ingest(session, app, body, request.app.state.settings.feed_allow_production)
        session.commit()
        return result


@router.get("/v1/traces/{id}")
def read_trace(id: feed.Id, request: Request) -> dict:
    import time

    from autoeval_api.models import FeedObjectRecord

    user = key_principal(request)
    with request.app.state.session_factory() as session:
        app = feed.key_resource(session, user, "traces:read")
        row = session.get(FeedObjectRecord, (app.id, "trace", id))
        if not row or row.expires <= time.time() * 1000:
            raise HTTPException(404, "Trace not found")
        return row.body


@router.get("/api/applications/{app_id}/experiments")
def experiments(app_id: str, request: Request) -> list[dict]:
    from autoeval_api.models import FeedObjectRecord

    with request.app.state.session_factory() as session:
        feed.resource(session, principal(request), app_id)
        return [
            row.body
            for row in session.scalars(
                select(FeedObjectRecord)
                .where(
                    FeedObjectRecord.application_id == app_id, FeedObjectRecord.kind == "experiment"
                )
                .limit(100)
            )
        ]


@router.get("/api/applications/{app_id}/comparisons/{left}/{right}")
def comparison(app_id: str, left: feed.Id, right: feed.Id, request: Request) -> dict:
    with request.app.state.session_factory() as session:
        app = feed.resource(session, principal(request), app_id)
        return feed.compare(session, app, left, right)


@router.get("/v1/comparisons/{left}/{right}")
def read_comparison(left: feed.Id, right: feed.Id, request: Request) -> dict:
    user = key_principal(request)
    with request.app.state.session_factory() as session:
        app = feed.key_resource(session, user, "traces:read")
        return feed.compare(session, app, left, right)
