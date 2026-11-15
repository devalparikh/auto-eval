"""App-owned capture: immutable declarations, scoped evidence and explicit erasure."""

import hashlib
import json
import math
import re
import secrets
import time
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, select, text

from autoeval_api.models import (
    ApplicationCaptureSettingsRecord,
    ApplicationKeyRecord,
    ApplicationRecord,
    FeedObjectRecord,
)
from autoeval_api.services import application_contract as contract
from autoeval_api.services.hosted_auth import denied, digest

SCOPE = "application:connect"
EVIDENCE = ("trace", "trace2", "content2", "outcome2", "assessment2")
# A backstop, not an anonymity guarantee. Domain minimization happens before transmission.
PROHIBITED = re.compile(
    r"[\w.+-]{1,64}@[\w.-]{1,253}\.[a-zA-Z]{2,63}|"
    r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b|"
    r"\b(?:Bearer\s+\S+|sk-[A-Za-z0-9_-]{16,}|ae_[A-Za-z0-9_-]{32,})|"
    r"https?://\S+|\b(?:\+?\d[ ()-]*){10,15}\b",
    re.IGNORECASE,
)


def canonical(body):
    return json.dumps(
        body, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    )


def fingerprint(kind, body):
    return hashlib.sha256(("autoeval:v2:" + kind + ":" + canonical(body)).encode()).hexdigest()


def now_ms():
    return int(time.time() * 1000)


def alive(row):
    return row is not None and not row.revoked and (row.expires == 0 or row.expires > now_ms())


def active_clause():
    return or_(FeedObjectRecord.expires == 0, FeedObjectRecord.expires > now_ms())


def lock_sqlite(session):
    # SQLite ignores FOR UPDATE. Reserve the writer before reading consent/settings;
    # the reservation lasts until this request commits or closes its session.
    if session.get_bind().dialect.name == "sqlite":
        session.execute(text("BEGIN IMMEDIATE"))


def resource(session, principal, app_id, *, write=False, content=False):
    lock_sqlite(session)
    app = session.scalar(
        select(ApplicationRecord).where(ApplicationRecord.id == app_id).with_for_update()
    )
    if not app:
        raise HTTPException(404, "Application not found")
    if principal.get("role") != "admin" and (
        write or content or app_id not in principal.get("resources", [])
    ):
        denied(403)
    return app


def settings(session, app):
    row = session.get(ApplicationCaptureSettingsRecord, app.id)
    if row is None:
        raise HTTPException(409, "Capture settings required")
    return row


def settings_dict(row):
    return {key: getattr(row, key) for key in contract.CaptureSettings.model_fields}


def application_dict(session, app):
    snapshot = settings_dict(settings(session, app))
    return {
        "id": app.id,
        "name": app.name,
        "settings": snapshot,
        "settingsVersion": fingerprint("settings", snapshot),
    }


def audit(session, app_id, principal, action, body):
    immutable(
        session,
        app_id,
        "audit2",
        str(uuid4()),
        {
            "action": action,
            "at": now_ms(),
            "actor": principal.get("subject", "local-admin"),
            "settings": body,
        },
    )


def create_application(session, principal, body):
    if principal.get("role") != "admin":
        denied(403)
    if session.get(ApplicationRecord, body.id):
        raise HTTPException(409, "Application already exists")
    # Legacy columns are retained for historical data, not used by capture v2.
    app = ApplicationRecord(
        id=body.id, name=body.name, environment="sdk", policy={}, retention_days=0
    )
    session.add(app)
    session.flush()
    session.add(
        ApplicationCaptureSettingsRecord(
            application_id=app.id, **contract.CaptureSettings().model_dump()
        )
    )
    audit(session, app.id, principal, "created", contract.CaptureSettings().model_dump())
    key = issue_key(session, app.id, body.key) if body.key else None
    return {"id": app.id, "key": key}


def update_settings(session, app, principal, body, expected_version=None):
    row = settings(session, app)
    if expected_version is not None and expected_version != fingerprint(
        "settings", settings_dict(row)
    ):
        raise HTTPException(409, "Settings changed; reload before saving")
    # An explicit admin choice before first connect must not be overwritten by the SDK.
    if body.content_categories != row.content_categories:
        row.categories_initialized = True
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    # Decreasing a deadline never changes content and can never extend an existing record.
    records = session.scalars(
        select(FeedObjectRecord).where(
            FeedObjectRecord.application_id == app.id,
            FeedObjectRecord.kind.in_((*EVIDENCE, "receipt2")),
        )
    ).all()
    for record in records:
        parent = (
            session.get(FeedObjectRecord, (app.id, "trace2", record.parent_id))
            if record.parent_id
            else record
        )
        if parent is None:
            continue
        start = (
            record.body.get("startedAt")
            if record.kind == "receipt2"
            else parent.body.get("startedAt")
        )
        if start is None:
            continue
        days = body.retention_days
        if record.kind in ("content2", "receipt2") and body.content_retention_days is not None:
            days = (
                min(days, body.content_retention_days)
                if days is not None
                else body.content_retention_days
            )
        if days is not None:
            deadline = start + days * 86400000
            record.expires = min(record.expires, deadline) if record.expires else deadline
    session.flush()
    purge(session)
    audit(session, app.id, principal, "settings", body.model_dump())
    return settings_dict(row)


def key_dict(key):
    return {
        "id": key.id,
        "label": key.label,
        "scope": key.scope,
        "createdAt": int(key.created * 1000),
        "expiresAt": int(key.expires * 1000),
        "retireAt": int(key.retire_at * 1000) if key.retire_at else None,
        "revoked": key.revoked,
    }


def issue_key(session, app_id, body):
    if not now_ms() < body.expiresAt <= now_ms() + 90 * 86400000:
        raise HTTPException(400, "Key expiration must be within 90 days")
    value = "ae_" + secrets.token_urlsafe(32)
    row = ApplicationKeyRecord(
        application_id=app_id,
        digest=digest(value),
        scope=SCOPE,
        label=body.label,
        created=time.time(),
        expires=body.expiresAt / 1000,
    )
    session.add(row)
    session.flush()
    return {**key_dict(row), "token": value}


def change_key(session, app, key_id, body=None):
    key = session.get(ApplicationKeyRecord, key_id)
    if key is None or key.application_id != app.id:
        raise HTTPException(404, "Key not found")
    if body is None:
        key.revoked = True
        return {"revoked": True}
    if (
        key.revoked
        or key.scope != SCOPE
        or key.expires <= time.time()
        or (key.retire_at and key.retire_at <= time.time())
    ):
        raise HTTPException(409, "Key is inactive")
    if body.retireAt is not None:
        if not now_ms() < body.retireAt <= key.expires * 1000:
            raise HTTPException(400, "Invalid overlap deadline")
        if key.retire_at and body.retireAt > key.retire_at * 1000:
            raise HTTPException(409, "Cannot extend a scheduled retirement")
        key.retire_at = body.retireAt / 1000
    else:
        key.revoked = True
    return issue_key(session, app.id, body)


def key_resource(session, principal):
    if principal.get("scope") != SCOPE:
        denied(403)
    lock_sqlite(session)
    app = session.scalar(
        select(ApplicationRecord)
        .where(ApplicationRecord.id == principal["application_id"])
        .with_for_update()
    )
    key = session.get(ApplicationKeyRecord, principal["key_id"], populate_existing=True)
    if (
        not app
        or not key
        or key.revoked
        or key.expires <= time.time()
        or (key.retire_at and key.retire_at <= time.time())
    ):
        denied()
    return app


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
    # Erasure receipts must outlive data without imposing a lifetime capture ceiling.
    if kind != "receipt2" and count >= 10000:
        raise HTTPException(429, "Application storage limit reached")
    row = FeedObjectRecord(application_id=app_id, kind=kind, id=id, body=body, **kwargs)
    session.add(row)
    session.flush()
    return row


def connect(session, app, body):
    policy = body.policy.model_dump()
    policy_id = fingerprint("policy", policy)
    experiment = {**body.experiment.model_dump(), "policyVersion": policy_id, "source": body.source}
    if experiment["mode"] != "observed" and body.source != "synthetic":
        raise HTTPException(409, "Evaluations require synthetic provenance")
    if experiment["datasetHash"] and not session.get(
        FeedObjectRecord, (app.id, "dataset", experiment["datasetHash"])
    ):
        raise HTTPException(409, "Finalized dataset required")
    experiment_id = fingerprint("experiment", experiment)
    immutable(session, app.id, "policy2", policy_id, policy)
    immutable(session, app.id, "experiment2", experiment_id, experiment)
    config = settings(session, app)
    if not config.categories_initialized:
        config.content_categories = sorted(
            {field["category"] for field in policy["content"].values()}
        )
        config.categories_initialized = True
        audit(
            session,
            app.id,
            {},
            "first_policy_categories",
            {"policyVersion": policy_id, "categories": config.content_categories},
        )
    return {
        "applicationId": app.id,
        "policyVersion": policy_id,
        "experimentId": experiment_id,
        "settings": settings_dict(settings(session, app)),
    }


def check_source(config, source):
    if source == "production" and not config.production_enabled:
        denied(403)


def policy_contract(session, app, policy_id):
    row = session.get(FeedObjectRecord, (app.id, "policy2", policy_id))
    if row is None:
        raise HTTPException(404, "Policy unavailable")
    return row.body


def grant(session, app, body):
    check_source(settings(session, app), body.source)
    if body.expiresAt is not None and body.expiresAt <= now_ms():
        raise HTTPException(400, "Consent expired")
    value = body.model_dump()
    value["categories"] = sorted(set(value["categories"]))
    immutable(session, app.id, "grant2", body.id, value, expires=body.expiresAt or 0)
    return {"id": body.id, "scopeVersion": fingerprint("consent", value["categories"])}


def revoke_grant(session, app, id):
    row = session.get(FeedObjectRecord, (app.id, "grant2", id))
    if not row:
        row = immutable(session, app.id, "grant2", id, {}, revoked=True)
    row.revoked = True
    session.execute(
        delete(FeedObjectRecord).where(
            FeedObjectRecord.application_id == app.id,
            FeedObjectRecord.kind.in_(EVIDENCE),
            FeedObjectRecord.grant_id == id,
        )
    )
    return {"revoked": True}


def purge(session):
    session.execute(
        delete(FeedObjectRecord).where(
            FeedObjectRecord.kind.in_(EVIDENCE),
            FeedObjectRecord.expires > 0,
            FeedObjectRecord.expires <= now_ms(),
        )
    )


def valid_value(value, spec):
    if value is None:
        return True
    kind = spec["type"]
    if kind in {"number", "integer"}:
        return (
            type(value) in (int, float)
            and abs(value) <= 9007199254740991
            and math.isfinite(value)
            and (kind != "integer" or int(value) == value)
        )
    if kind == "boolean":
        return type(value) is bool
    if kind == "string":
        try:
            length = len(value.encode()) if isinstance(value, str) else 0
        except UnicodeEncodeError:
            return False
        return (
            isinstance(value, str)
            and length <= spec["maxLength"]
            and (not spec["enum"] or value in spec["enum"])
        )
    if kind == "array":
        return (
            isinstance(value, list)
            and len(value) <= spec["maxItems"]
            and all(valid_value(item, spec["items"]) for item in value)
        )
    return (
        isinstance(value, dict)
        and set(value) == set(spec["properties"])
        and all(valid_value(value[key], child) for key, child in spec["properties"].items())
    )


def project_attributes(attributes, definition):
    if set(attributes) != set(definition["attributes"]):
        return None
    if not all(
        valid_value(attributes[key], spec) for key, spec in definition["attributes"].items()
    ):
        return None
    return attributes


def project_content(body, policy, config, consent):
    accepted, coverage = {}, {}
    for name, value in body.content.items():
        field = policy["content"].get(name)
        if field is None:
            raise HTTPException(400, "Undeclared content field")
        reason = None
        if (
            field["category"] not in config.content_categories
            or field["category"] not in consent.body["categories"]
        ):
            reason = "not_authorized"
        elif not body.redactorVersion:
            reason = "redaction_failed"
        elif not valid_value(value, field["valueSchema"]):
            reason = "invalid_value"
        elif PROHIBITED.search(canonical(value)):
            reason = "redaction_failed"
        if reason:
            coverage["content." + name] = reason
        else:
            accepted[name] = value
    return accepted, coverage


def expiry(config, start, consent, *, content=False, parent=0):
    limits = [value for value in (consent.expires, parent) if value]
    if config.retention_days is not None:
        limits.append(start + config.retention_days * 86400000)
    if content and config.content_retention_days is not None:
        limits.append(start + config.content_retention_days * 86400000)
    return min(limits) if limits else 0


def consent_for(session, app, id, source):
    consent = session.get(FeedObjectRecord, (app.id, "grant2", id))
    if not alive(consent) or consent.body.get("source") != source:
        denied(403)
    return consent


def ingest(session, app, body):
    config = settings(session, app)
    check_source(config, body.source)
    if not 0 <= body.endedAt - body.startedAt <= 86400000 or body.endedAt > now_ms() + 60000:
        raise HTTPException(400, "Invalid observation timing")
    consent = consent_for(session, app, body.grantId, body.source)
    experiment = session.get(FeedObjectRecord, (app.id, "experiment2", body.experimentId))
    if (
        experiment is None
        or experiment.body["policyVersion"] != body.policyVersion
        or experiment.body["source"] != body.source
    ):
        raise HTTPException(409, "Matching experiment required")
    policy = session.get(FeedObjectRecord, (app.id, "policy2", body.policyVersion)).body
    dataset_hash = experiment.body["datasetHash"]
    if dataset_hash:
        dataset = session.get(FeedObjectRecord, (app.id, "dataset", dataset_hash))
        if not dataset or body.source != "synthetic" or body.caseId not in dataset.body["caseIds"]:
            raise HTTPException(409, "Finalized dataset case required")
    elif body.caseId is not None:
        raise HTTPException(409, "Observed traces have no case")
    if not set(body.metrics) <= set(policy["metrics"]) or not set(body.checks) <= set(
        policy["checks"]
    ):
        raise HTTPException(400, "Undeclared projection field")
    allowed_coverage = {
        section + "." + name
        for section in ("metrics", "checks", "content")
        for name in policy[section]
    }
    if not set(body.coverage) <= allowed_coverage:
        raise HTTPException(400, "Invalid coverage")
    value = body.model_dump(exclude={"content"})
    coverage = value["coverage"]
    for section in ("metrics", "checks"):
        for name, definition in policy[section].items():
            item = getattr(body, section).get(name)
            valid = item is None
            if section == "checks":
                valid = valid or type(item) is bool
            elif type(item) in (int, float):
                valid = (
                    abs(item) <= 9007199254740991
                    and math.isfinite(item)
                    and (definition["min"] is None or item >= definition["min"])
                    and (definition["max"] is None or item <= definition["max"])
                    and (definition["unit"] != "count" or int(item) == item)
                )
            value[section][name] = item if valid else None
            path = section + "." + name
            if not valid:
                coverage[path] = "invalid_value"
            elif item is None:
                coverage.setdefault(path, "not_measured")
            else:
                coverage.pop(path, None)
    ids = set()
    for step in body.steps:
        if step.id in ids or (step.parentId is not None and step.parentId not in ids):
            raise HTTPException(400, "Invalid step relationship")
        ids.add(step.id)
        definition = policy["steps"].get(step.name)
        if definition is None or project_attributes(step.attributes, definition) is None:
            raise HTTPException(400, "Invalid step declaration")
    content, omitted = project_content(body, policy, config, consent)
    coverage.update(omitted)
    for name in policy["content"]:
        if name not in content:
            coverage.setdefault("content." + name, "not_measured")
        else:
            coverage.pop("content." + name, None)
    expires = expiry(config, body.startedAt, consent)
    if expires and expires <= now_ms():
        raise HTTPException(410, "Observation expired")
    content_expires = expiry(config, body.startedAt, consent, content=True)
    if content_expires and content_expires <= now_ms():
        coverage.update({"content." + name: "retention_expired" for name in content})
        content = {}
    request_digest = fingerprint("receipt", {"trace": value, "content": content})
    receipt = session.get(FeedObjectRecord, (app.id, "receipt2", body.id))
    prior = session.get(FeedObjectRecord, (app.id, "trace2", body.id))
    if receipt and not prior:
        raise HTTPException(410, "Observation expired or erased")
    if prior:
        if prior.request_digest != request_digest:
            raise HTTPException(409, "Immutable record conflict")
        return {"id": body.id, "coverage": prior.body["coverage"]}
    immutable(
        session,
        app.id,
        "receipt2",
        body.id,
        {"startedAt": body.startedAt, "kind": "trace2"},
        request_digest=request_digest,
        expires=content_expires,
    )
    immutable(
        session,
        app.id,
        "trace2",
        body.id,
        value,
        expires=expires,
        grant_id=consent.id,
        request_digest=request_digest,
    )
    if content and (not content_expires or content_expires > now_ms()):
        immutable(
            session,
            app.id,
            "content2",
            body.id,
            content,
            expires=content_expires,
            grant_id=consent.id,
            parent_id=body.id,
        )
    return {"id": body.id, "coverage": coverage}


def outcome(session, app, body):
    trace = session.get(FeedObjectRecord, (app.id, "trace2", body.traceId))
    if not alive(trace):
        raise HTTPException(410, "Trace unavailable")
    if trace.body["policyVersion"] != body.policyVersion:
        raise HTTPException(409, "Original policy required")
    config = settings(session, app)
    check_source(config, trace.body["source"])
    consent = consent_for(session, app, trace.grant_id, trace.body["source"])
    if not trace.body["startedAt"] <= body.occurredAt <= now_ms() + 60000:
        raise HTTPException(400, "Invalid outcome timing")
    policy = session.get(FeedObjectRecord, (app.id, "policy2", body.policyVersion)).body
    definition = policy["outcomes"].get(body.name)
    if definition is None or project_attributes(body.attributes, definition) is None:
        raise HTTPException(400, "Invalid outcome declaration")
    content, coverage = project_content(body, policy, config, consent)
    receipt = session.get(FeedObjectRecord, (app.id, "receipt2", trace.id))
    content_expires = expiry(
        config,
        trace.body["startedAt"],
        consent,
        content=True,
        parent=receipt.expires if receipt else trace.expires,
    )
    if content_expires and content_expires <= now_ms():
        coverage.update({"content." + name: "retention_expired" for name in content})
        content = {}
    value = {**body.model_dump(exclude={"content"}), "coverage": coverage}
    request_digest = fingerprint("receipt", {"event": value, "content": content})
    prior = session.get(FeedObjectRecord, (app.id, "outcome2", body.id))
    if session.get(FeedObjectRecord, (app.id, "receipt2", body.id)) and not prior:
        raise HTTPException(410, "Observation expired or erased")
    if prior:
        if prior.request_digest != request_digest:
            raise HTTPException(409, "Immutable record conflict")
        return {"id": prior.id, "coverage": prior.body["coverage"]}
    immutable(
        session,
        app.id,
        "receipt2",
        body.id,
        {"startedAt": trace.body["startedAt"], "kind": "outcome2"},
        request_digest=request_digest,
        expires=content_expires,
    )
    immutable(
        session,
        app.id,
        "outcome2",
        body.id,
        value,
        grant_id=consent.id,
        parent_id=trace.id,
        expires=trace.expires,
        request_digest=request_digest,
    )
    if content:
        immutable(
            session,
            app.id,
            "content2",
            body.id,
            content,
            grant_id=consent.id,
            parent_id=trace.id,
            expires=content_expires,
        )
    return {"id": body.id, "coverage": coverage}


def objects(session, app_id, kind, limit=100, *, after=None, evaluations_only=False):
    query = select(FeedObjectRecord).where(
        FeedObjectRecord.application_id == app_id, FeedObjectRecord.kind == kind, active_clause()
    )
    if after is not None:
        query = query.where(FeedObjectRecord.id > after)
    if evaluations_only:
        query = query.where(FeedObjectRecord.body["mode"].as_string().in_(("scripted", "live")))
    return [
        {**row.body, "id": row.id}
        for row in session.scalars(query.order_by(FeedObjectRecord.id).limit(limit))
    ]


def policy_categories(session, app_id, after=None):
    query = select(FeedObjectRecord.id, FeedObjectRecord.body["content"]).where(
        FeedObjectRecord.application_id == app_id, FeedObjectRecord.kind == "policy2"
    )
    if after is not None:
        query = query.where(FeedObjectRecord.id > after)
    return [
        {"id": id, "categories": sorted({field["category"] for field in content.values()})}
        for id, content in session.execute(query.order_by(FeedObjectRecord.id).limit(100))
    ]


def observations(session, app_id):
    return [
        row.body
        for row in session.scalars(
            select(FeedObjectRecord)
            .where(
                FeedObjectRecord.application_id == app_id,
                FeedObjectRecord.kind.in_(("trace", "trace2")),
                active_clause(),
            )
            .order_by(FeedObjectRecord.body["startedAt"].as_float().desc(), FeedObjectRecord.id)
            .limit(100)
        )
    ]


def detail(session, app, trace_id, *, content=False):
    row = session.get(FeedObjectRecord, (app.id, "trace2", trace_id))
    if not alive(row):
        raise HTTPException(404, "Trace unavailable")
    children = session.scalars(
        select(FeedObjectRecord).where(
            FeedObjectRecord.application_id == app.id,
            FeedObjectRecord.parent_id == trace_id,
            active_clause(),
        )
    ).all()
    return {
        "trace": row.body,
        "outcomes": [item.body for item in children if item.kind == "outcome2"],
        "assessments": [item.body for item in children if item.kind == "assessment2"],
        "content": {item.id: item.body for item in children if content and item.kind == "content2"},
    }


def assess(session, app, trace_id, principal, body):
    trace = session.get(FeedObjectRecord, (app.id, "trace2", trace_id))
    if not alive(trace):
        raise HTTPException(410, "Trace unavailable")
    value = {
        **body.model_dump(),
        "traceId": trace_id,
        "source": "human",
        "actor": principal.get("subject", "local-admin"),
    }
    immutable(
        session,
        app.id,
        "assessment2",
        body.id,
        value,
        parent_id=trace_id,
        grant_id=trace.grant_id,
        expires=trace.expires,
    )
    return {"id": body.id}


def erase_content(session, app):
    for receipt in session.scalars(
        select(FeedObjectRecord).where(
            FeedObjectRecord.application_id == app.id, FeedObjectRecord.kind == "receipt2"
        )
    ):
        receipt.expires = min(receipt.expires, now_ms()) if receipt.expires else now_ms()
    session.execute(
        delete(FeedObjectRecord).where(
            FeedObjectRecord.application_id == app.id, FeedObjectRecord.kind == "content2"
        )
    )
    return {"deleted": True}


def save_dataset(session, app, body):
    value = body.model_dump()
    hash = hashlib.sha256(canonical(value).encode()).hexdigest()
    immutable(session, app.id, "dataset", hash, value)
    return {"hash": hash}


def compare(session, app, left_id, right_id):
    runs = [
        session.get(FeedObjectRecord, (app.id, "experiment2", id)) for id in (left_id, right_id)
    ]
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
    policies = [
        session.get(FeedObjectRecord, (app.id, "policy2", run.body["policyVersion"])).body
        for run in runs
    ]
    indexed = []
    for run in runs:
        rows = session.scalars(
            select(FeedObjectRecord).where(
                FeedObjectRecord.application_id == app.id,
                FeedObjectRecord.kind == "trace2",
                active_clause(),
                FeedObjectRecord.body["experimentId"].as_string() == run.id,
            )
        ).all()
        cases = {row.body["caseId"]: row.body for row in rows}
        if (
            len(cases) != len(rows)
            or set(cases) != set(dataset.body["caseIds"])
            or any(row.body["source"] != "synthetic" for row in rows)
        ):
            raise HTTPException(409, "Complete unique synthetic cases required")
        indexed.append(cases)
    fields = []
    for section in ("metrics", "checks"):
        sides = [
            {
                definition["semanticId"]: (name, definition)
                for name, definition in policy[section].items()
            }
            for policy in policies
        ]
        for semantic_id in sorted(set(sides[0]) | set(sides[1])):
            before, after = sides[0].get(semantic_id), sides[1].get(semantic_id)
            compatible = before is not None and after is not None and before[1] == after[1]
            fields.append(
                {
                    "section": section,
                    "semanticId": semantic_id,
                    "beforeName": before[0] if before else None,
                    "afterName": after[0] if after else None,
                    "compatible": compatible,
                    "expected": before[1].get("expected") if compatible else None,
                }
            )
    return {
        "datasetHash": left["datasetHash"],
        "mode": left["mode"],
        "fields": fields,
        "cases": [
            {
                "id": case,
                "beforeStatus": indexed[0][case]["status"],
                "afterStatus": indexed[1][case]["status"],
                "values": [
                    {
                        **field,
                        "before": indexed[0][case][field["section"]].get(field["beforeName"]),
                        "after": indexed[1][case][field["section"]].get(field["afterName"]),
                        "beforeResult": comparison_result(indexed[0][case], field, "beforeName"),
                        "afterResult": comparison_result(indexed[1][case], field, "afterName"),
                    }
                    for field in fields
                ],
            }
            for case in dataset.body["caseIds"]
        ],
    }


def comparison_result(trace, field, name_key):
    if not field["compatible"]:
        return "not_comparable"
    if trace["status"] in ("error", "partial"):
        return "fail"
    value = trace[field["section"]].get(field[name_key])
    if trace["status"] == "cancelled" or value is None:
        return "unknown"
    if field["section"] == "metrics" or field["expected"] is None:
        return "descriptive"
    return "pass" if value == field["expected"] else "fail"
