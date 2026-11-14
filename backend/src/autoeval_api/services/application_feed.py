"""App-owned inference observations. No inference execution or arbitrary payload storage."""

import hashlib
import json
import secrets
import time
from typing import Annotated, Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import delete, func, select

from autoeval_api.models import ApplicationKeyRecord, ApplicationRecord, FeedObjectRecord
from autoeval_api.services.hosted_auth import denied, digest

Label = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,47}$")]
Hash = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
Id = Annotated[
    str, Field(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class Policy(Strict):
    metrics: list[Label] = Field(max_length=32)
    checks: list[Label] = Field(max_length=32)

    @model_validator(mode="after")
    def unique(self):
        if len(set(self.metrics)) != len(self.metrics) or len(set(self.checks)) != len(self.checks):
            raise ValueError("Policy labels must be unique")
        return self


class ApplicationInput(Strict):
    id: Id
    name: str = Field(min_length=1, max_length=96)
    environment: Label
    policy: Policy
    retention_days: int = Field(ge=1, le=30)


class KeyInput(Strict):
    scope: Literal["traces:write", "grants:write", "traces:read"]
    expires_in_days: int = Field(default=30, ge=1, le=90)


class Grant(Strict):
    id: Id
    source: Literal["synthetic", "production"]
    expiresAt: int = Field(ge=0, le=9007199254740991)
    policy: Literal["metadata-v1"]


class Dataset(Strict):
    schemaVersion: Literal[1]
    caseIds: list[Hash] = Field(min_length=1, max_length=100)
    rubricHash: Hash

    @model_validator(mode="after")
    def ordered(self):
        if self.caseIds != sorted(set(self.caseIds)):
            raise ValueError("Cases must be sorted and unique")
        return self


class Experiment(Strict):
    id: Id
    revision: str = Field(pattern=r"^[0-9a-f]{40}$")
    promptHash: Hash
    configHash: Hash
    graphHash: Hash | None
    model: str = Field(pattern=r"^[a-zA-Z][a-zA-Z0-9_.:/-]{0,95}$")
    mode: Literal["scripted", "live", "observed"]
    datasetHash: Hash | None

    @model_validator(mode="after")
    def dataset_required(self):
        if (self.mode == "observed") != (self.datasetHash is None):
            raise ValueError("Evaluations require a finalized dataset")
        return self


class Observation(Strict):
    schemaVersion: Literal[1]
    id: Id
    experimentId: Id
    grantId: Id
    source: Literal["synthetic", "production"]
    policy: Literal["metadata-v1"]
    caseId: Hash | None
    startedAt: int = Field(ge=0, le=9007199254740991)
    endedAt: int = Field(ge=0, le=9007199254740991)
    status: Literal["ok", "error", "partial"]
    metrics: dict[Label, Annotated[float, Field(ge=0, le=9007199254740991)] | None] = Field(
        max_length=32
    )
    checks: dict[Label, bool | None] = Field(max_length=32)


def canonical(body):
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def resource(session, principal, app_id, *, write=False):
    app = session.scalar(
        select(ApplicationRecord).where(ApplicationRecord.id == app_id).with_for_update()
    )
    if not app:
        raise HTTPException(404, "Application not found")
    if principal.get("role") != "admin" and (write or app_id not in principal.get("resources", [])):
        denied(403)
    return app


def issue_key(session, app_id, body):
    value = "ae_" + secrets.token_urlsafe(32)
    row = ApplicationKeyRecord(
        application_id=app_id,
        digest=digest(value),
        scope=body.scope,
        expires=time.time() + body.expires_in_days * 86400,
    )
    session.add(row)
    session.flush()
    return {"id": row.id, "token": value, "scope": row.scope, "expires": row.expires}


def key_resource(session, principal, scope):
    if principal.get("scope") != scope:
        denied(403)
    # Serialize ingestion, consent withdrawal and key rotation per application.
    app = session.scalar(
        select(ApplicationRecord)
        .where(ApplicationRecord.id == principal["application_id"])
        .with_for_update()
    )
    key = session.get(ApplicationKeyRecord, principal["key_id"], populate_existing=True)
    if not app or not key or key.revoked or key.expires <= time.time():
        denied()
    return app


def purge(session):
    session.execute(
        delete(FeedObjectRecord).where(
            FeedObjectRecord.kind == "trace", FeedObjectRecord.expires <= time.time() * 1000
        )
    )


def immutable(session, app_id, kind, id, body, **kwargs):
    prior = session.get(FeedObjectRecord, (app_id, kind, id))
    if prior:
        if prior.body != body or prior.revoked:
            raise HTTPException(409, "Immutable record conflict")
        return prior
    count = session.scalar(
        select(func.count())
        .select_from(FeedObjectRecord)
        .where(FeedObjectRecord.application_id == app_id, FeedObjectRecord.kind == kind)
    )
    if count >= 10000:
        raise HTTPException(429, "Application storage limit reached")
    row = FeedObjectRecord(application_id=app_id, kind=kind, id=id, body=body, **kwargs)
    session.add(row)
    session.flush()
    return row


def grant(session, app, body, allow_production):
    now = time.time() * 1000
    if body.source == "production" and not allow_production:
        denied(403)
    if not now < body.expiresAt <= now + 30 * 86400000:
        raise HTTPException(400, "Invalid grant expiry")
    immutable(session, app.id, "grant", body.id, body.model_dump(), expires=body.expiresAt)
    return {"id": body.id}


def revoke_grant(session, app, id):
    UUID(id)
    row = session.get(FeedObjectRecord, (app.id, "grant", id))
    if not row:
        row = immutable(session, app.id, "grant", id, {}, revoked=True)
    row.revoked = True
    session.execute(
        delete(FeedObjectRecord).where(
            FeedObjectRecord.application_id == app.id,
            FeedObjectRecord.kind == "trace",
            FeedObjectRecord.grant_id == id,
        )
    )
    return {"revoked": True}


def ingest(session, app, body, allow_production):
    now = time.time() * 1000
    if body.source == "production" and not allow_production:
        denied(403)
    if (
        set(body.metrics) != set(app.policy["metrics"])
        or set(body.checks) != set(app.policy["checks"])
        or not 0 <= body.endedAt - body.startedAt <= 86400000
        or body.endedAt > now + 60000
        or body.startedAt < now - app.retention_days * 86400000
    ):
        raise HTTPException(400, "Invalid observation policy or timing")
    consent = session.get(FeedObjectRecord, (app.id, "grant", body.grantId))
    if (
        not consent
        or consent.revoked
        or consent.expires <= now
        or consent.body["source"] != body.source
    ):
        denied(403)
    experiment = session.get(FeedObjectRecord, (app.id, "experiment", body.experimentId))
    if not experiment:
        raise HTTPException(409, "Experiment required")
    dataset_hash = experiment.body["datasetHash"]
    if dataset_hash:
        dataset = session.get(FeedObjectRecord, (app.id, "dataset", dataset_hash))
        if not dataset or body.source != "synthetic" or body.caseId not in dataset.body["caseIds"]:
            raise HTTPException(409, "Finalized dataset case required")
    elif body.caseId is not None:
        raise HTTPException(409, "Observed experiments have no dataset cases")
    expires = min(body.startedAt + app.retention_days * 86400000, consent.expires)
    if expires <= now:
        raise HTTPException(410, "Observation expired")
    immutable(
        session, app.id, "trace", body.id, body.model_dump(), expires=expires, grant_id=body.grantId
    )
    return {"id": body.id}


def save_dataset(session, app, body):
    value = body.model_dump()
    hash = hashlib.sha256(canonical(value).encode()).hexdigest()
    immutable(session, app.id, "dataset", hash, value)
    return {"hash": hash}


def save_experiment(session, app, body):
    if body.datasetHash and not session.get(
        FeedObjectRecord, (app.id, "dataset", body.datasetHash)
    ):
        raise HTTPException(409, "Finalized dataset required")
    immutable(session, app.id, "experiment", body.id, body.model_dump())
    return {"id": body.id}


def observations(session, app_id):
    return [
        row.body
        for row in session.scalars(
            select(FeedObjectRecord)
            .where(
                FeedObjectRecord.application_id == app_id,
                FeedObjectRecord.kind == "trace",
                FeedObjectRecord.expires > time.time() * 1000,
            )
            .order_by(FeedObjectRecord.body["startedAt"].as_float().desc(), FeedObjectRecord.id)
            .limit(100)
        )
    ]


def compare(session, app, left_id, right_id):
    runs = [session.get(FeedObjectRecord, (app.id, "experiment", id)) for id in (left_id, right_id)]
    if any(run is None for run in runs):
        raise HTTPException(404, "Experiment not found")
    left, right = [run.body for run in runs]
    if (
        not left["datasetHash"]
        or left["datasetHash"] != right["datasetHash"]
        or left["mode"] != right["mode"]
    ):
        raise HTTPException(409, "Comparison requires the same finalized dataset and mode")
    dataset = session.get(FeedObjectRecord, (app.id, "dataset", left["datasetHash"]))
    by_run = []
    for id in (left_id, right_id):
        rows = session.scalars(
            select(FeedObjectRecord).where(
                FeedObjectRecord.application_id == app.id,
                FeedObjectRecord.kind == "trace",
                FeedObjectRecord.expires > time.time() * 1000,
            )
        ).all()
        traces = [row.body for row in rows if row.body["experimentId"] == id]
        indexed = {trace["caseId"]: trace for trace in traces}
        if (
            len(traces) != len(indexed)
            or set(indexed) != set(dataset.body["caseIds"])
            or any(trace["source"] != "synthetic" for trace in traces)
        ):
            raise HTTPException(
                409, "Comparison requires exactly one unexpired synthetic trace per case"
            )
        by_run.append(indexed)
    return {
        "datasetHash": left["datasetHash"],
        "mode": left["mode"],
        "cases": [
            {
                "id": id,
                "beforeStatus": by_run[0][id]["status"],
                "afterStatus": by_run[1][id]["status"],
                "checks": [
                    {
                        "name": name,
                        "before": by_run[0][id]["checks"][name],
                        "after": by_run[1][id]["checks"][name],
                    }
                    for name in app.policy["checks"]
                ],
            }
            for id in dataset.body["caseIds"]
        ],
    }
