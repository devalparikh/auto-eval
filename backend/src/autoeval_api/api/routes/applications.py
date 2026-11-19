"""Operator administration and the single app-scoped SDK capture boundary."""

from typing import Annotated

from fastapi import APIRouter, Header, Request
from sqlalchemy import select

from autoeval_api.models import ApplicationKeyRecord, ApplicationRecord
from autoeval_api.services import application_contract as contract
from autoeval_api.services import application_feed as feed
from autoeval_api.services.hosted_auth import rate_limit

router = APIRouter(tags=["application feed"])


def principal(request):
    return getattr(request.state, "principal", {"role": "admin"})


def key_principal(request):
    user = request.app.state.hosted_auth.authenticate(request)
    if "key_id" not in user:
        feed.denied(403)
    rate_limit(request.app.state.session_factory, "key:" + user["key_id"], 120)
    return user


@router.get("/api/applications")
def applications(request: Request) -> list[dict]:
    user = principal(request)
    with request.app.state.session_factory() as session:
        return [
            feed.application_dict(session, app)
            for app in session.scalars(select(ApplicationRecord))
            if user.get("role") == "admin" or app.id in user.get("resources", [])
        ]


@router.post("/api/applications", status_code=201)
def create_application(body: contract.ApplicationInput, request: Request) -> dict:
    with request.app.state.session_factory() as session:
        result = feed.create_application(session, principal(request), body)
        session.commit()
        return result


@router.put("/api/applications/{app_id}/settings")
def settings(app_id: contract.Id, body: contract.CaptureSettings, request: Request) -> dict:
    with request.app.state.session_factory() as session:
        app = feed.resource(session, principal(request), app_id, write=True)
        result = feed.update_settings(
            session, app, principal(request), body, request.headers.get("if-match")
        )
        session.commit()
        return result


@router.post("/api/applications/{app_id}/keys", status_code=201)
def issue_key(app_id: contract.Id, body: contract.KeyInput, request: Request) -> dict:
    with request.app.state.session_factory() as session:
        feed.resource(session, principal(request), app_id, write=True)
        result = feed.issue_key(session, app_id, body)
        feed.audit(session, app_id, principal(request), "key_issued", {"keyId": result["id"]})
        session.commit()
        return result


@router.get("/api/applications/{app_id}/keys")
def keys(app_id: contract.Id, request: Request) -> list[dict]:
    with request.app.state.session_factory() as session:
        feed.resource(session, principal(request), app_id, write=True)
        return [
            feed.key_dict(key)
            for key in session.scalars(
                select(ApplicationKeyRecord).where(ApplicationKeyRecord.application_id == app_id)
            )
        ]


@router.post("/api/applications/{app_id}/keys/{key_id}/revoke")
def revoke_key(app_id: contract.Id, key_id: contract.Id, request: Request) -> dict:
    with request.app.state.session_factory() as session:
        app = feed.resource(session, principal(request), app_id, write=True)
        result = feed.change_key(session, app, key_id)
        feed.audit(session, app_id, principal(request), "key_revoked", {"keyId": key_id})
        session.commit()
        return result


@router.post("/api/applications/{app_id}/keys/{key_id}/rotate")
def rotate_key(
    app_id: contract.Id, key_id: contract.Id, body: contract.RotationInput, request: Request
) -> dict:
    with request.app.state.session_factory() as session:
        app = feed.resource(session, principal(request), app_id, write=True)
        result = feed.change_key(session, app, key_id, body)
        feed.audit(
            session,
            app_id,
            principal(request),
            "key_rotated",
            {"keyId": key_id, "replacementId": result["id"], "retireAt": body.retireAt},
        )
        session.commit()
        return result


@router.post("/api/applications/{app_id}/datasets", status_code=201)
def dataset(app_id: contract.Id, body: contract.Dataset, request: Request) -> dict:
    with request.app.state.session_factory() as session:
        app = feed.resource(session, principal(request), app_id, write=True)
        result = feed.save_dataset(session, app, body)
        session.commit()
        return result


@router.get("/api/applications/{app_id}/traces")
def dashboard(app_id: contract.Id, request: Request) -> list[dict]:
    with request.app.state.session_factory() as session:
        feed.resource(session, principal(request), app_id)
        feed.purge(session)
        result = feed.observations(session, app_id)
        session.commit()
        return result


@router.get("/api/applications/{app_id}/traces/{trace_id}")
def detail(app_id: contract.Id, trace_id: contract.Id, request: Request) -> dict:
    with request.app.state.session_factory() as session:
        app = feed.resource(session, principal(request), app_id)
        return feed.detail(session, app, trace_id)


@router.get("/api/applications/{app_id}/traces/{trace_id}/content")
def content(app_id: contract.Id, trace_id: contract.Id, request: Request) -> dict:
    with request.app.state.session_factory() as session:
        app = feed.resource(session, principal(request), app_id, content=True)
        return feed.detail(session, app, trace_id, content=True)


@router.delete("/api/applications/{app_id}/content")
def erase_content(app_id: contract.Id, request: Request) -> dict:
    with request.app.state.session_factory() as session:
        app = feed.resource(session, principal(request), app_id, write=True)
        result = feed.erase_content(session, app)
        feed.audit(session, app_id, principal(request), "content_erased", {})
        session.commit()
        return result


@router.post("/api/applications/{app_id}/traces/{trace_id}/assessments", status_code=201)
def assess(
    app_id: contract.Id, trace_id: contract.Id, body: contract.Assessment, request: Request
) -> dict:
    with request.app.state.session_factory() as session:
        app = feed.resource(session, principal(request), app_id, write=True)
        result = feed.assess(session, app, trace_id, principal(request), body)
        session.commit()
        return result


@router.get("/api/applications/{app_id}/policies")
def policies(app_id: contract.Id, request: Request) -> list[dict]:
    with request.app.state.session_factory() as session:
        feed.resource(session, principal(request), app_id)
        return feed.objects(session, app_id, "policy2")


@router.get("/api/applications/{app_id}/experiments")
def experiments(
    app_id: contract.Id,
    request: Request,
    after: contract.Hash | None = None,
    evaluations_only: bool = False,
) -> list[dict]:
    with request.app.state.session_factory() as session:
        feed.resource(session, principal(request), app_id)
        return feed.objects(
            session, app_id, "experiment2", after=after, evaluations_only=evaluations_only
        )


@router.get("/api/applications/{app_id}/policy-categories")
def policy_categories(
    app_id: contract.Id, request: Request, after: contract.Hash | None = None
) -> list[dict]:
    with request.app.state.session_factory() as session:
        feed.resource(session, principal(request), app_id)
        return feed.policy_categories(session, app_id, after)


@router.get("/api/applications/{app_id}/comparisons/{left}/{right}")
def comparison(
    app_id: contract.Id, left: contract.Hash, right: contract.Hash, request: Request
) -> dict:
    with request.app.state.session_factory() as session:
        app = feed.resource(session, principal(request), app_id)
        return feed.compare(session, app, left, right)


@router.post("/v2/connect")
def connect(body: contract.Connection, request: Request) -> dict:
    user = key_principal(request)
    with request.app.state.session_factory() as session:
        app = feed.key_resource(session, user)
        result = feed.connect(session, app, body)
        session.commit()
        return result


@router.post("/v2/grants", status_code=201)
def grant(body: contract.Grant, request: Request) -> dict:
    user = key_principal(request)
    with request.app.state.session_factory() as session:
        app = feed.key_resource(session, user)
        result = feed.grant(session, app, body)
        session.commit()
        return result


@router.get("/v2/policies/{policy_id}")
def sdk_policy(policy_id: contract.Hash, request: Request) -> dict:
    """Only the app's declaration, for delayed outcomes across deployments. No evidence."""
    user = key_principal(request)
    with request.app.state.session_factory() as session:
        app = feed.key_resource(session, user)
        return feed.policy_contract(session, app, policy_id)


@router.delete("/v2/grants/{id}")
def revoke_grant(id: contract.Id, request: Request) -> dict:
    user = key_principal(request)
    with request.app.state.session_factory() as session:
        app = feed.key_resource(session, user)
        result = feed.revoke_grant(session, app, id)
        session.commit()
        return result


@router.post("/v2/traces", status_code=201)
def ingest(body: contract.Observation, request: Request) -> dict:
    user = key_principal(request)
    with request.app.state.session_factory() as session:
        app = feed.key_resource(session, user)
        feed.purge(session)
        result = feed.ingest(session, app, body)
        session.commit()
        return result


@router.post("/v2/outcomes", status_code=201)
def outcome(body: contract.Outcome, request: Request) -> dict:
    user = key_principal(request)
    with request.app.state.session_factory() as session:
        app = feed.key_resource(session, user)
        feed.purge(session)
        result = feed.outcome(session, app, body)
        session.commit()
        return result


@router.post("/v2/traces/{trace_id}/grades", status_code=201)
def grade_trace(
    trace_id: contract.Id,
    body: contract.GradeInput,
    request: Request,
    idempotency_key: Annotated[contract.Id | None, Header()] = None,
) -> dict:
    user = key_principal(request)
    with request.app.state.session_factory() as session:
        app = feed.key_resource(session, user)
        result = feed.grade_trace(session, app, trace_id, body, idempotency_key)
        session.commit()
        return result
