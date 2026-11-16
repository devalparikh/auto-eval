"""Capture v2 trust boundaries, automatic evolution and immutable evidence."""

import copy
import time
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import DatabaseError
from test_hosted import EMAIL, ORIGIN, SUBJECT, login
from test_hosted import hosted as hosted
from test_hosted_migrations import postgres as postgres

from autoeval_api.models import ApplicationKeyRecord, FeedObjectRecord


def policy():
    return {
        "schemaVersion": 2,
        "metrics": {
            "latency_ms": {
                "semanticId": "run.latency",
                "definitionVersion": 1,
                "unit": "ms",
                "min": 0,
            }
        },
        "checks": {
            "passed": {"semanticId": "reply.valid", "definitionVersion": 1, "expected": True}
        },
        "steps": {"read_records": {"attributes": {"rows": {"type": "integer"}}}},
        "outcomes": {
            "proposal_decision": {
                "attributes": {
                    "decision": {"type": "string", "enum": ["applied", "dismissed", "stale"]}
                }
            }
        },
        "content": {
            "request": {"category": "conversation", "valueSchema": {"type": "string"}},
            "scan": {
                "category": "body_scans",
                "valueSchema": {"type": "object", "properties": {"lean_mass": {"type": "number"}}},
            },
        },
    }


def experiment():
    return {
        "revision": {"kind": "git-sha1", "value": "a" * 40},
        "promptHash": "b" * 64,
        "configHash": "c" * 64,
        "graphHash": None,
        "models": [{"role": "trainer", "provider": "mock", "model": "synthetic/mock"}],
        "mode": "observed",
    }


@pytest.fixture
def feed(hosted):
    admin, app, _, _, _ = hosted
    login(admin)
    app_id = str(uuid4())
    base = f"/api/applications/{app_id}"
    created = admin.post(
        "/api/applications",
        json={"id": app_id, "name": "Synthetic fixture"},
    )
    assert created.status_code == 201, created.text
    key = admin.post(
        base + "/keys", json={"label": "test", "expiresAt": int(time.time() * 1000) + 86400000}
    ).json()
    with TestClient(app, base_url=ORIGIN) as sdk:
        sdk.headers["authorization"] = "Bearer " + key["token"]
        connected = sdk.post("/v2/connect", json={"policy": policy(), "experiment": experiment()})
        assert connected.status_code == 200, connected.text
        ids = connected.json()
        grant = {
            "id": str(uuid4()),
            "source": "synthetic",
            "categories": ["conversation", "body_scans"],
        }
        assert sdk.post("/v2/grants", json=grant).status_code == 201
        now = int(time.time() * 1000)
        trace = {
            "schemaVersion": 2,
            "id": str(uuid4()),
            "experimentId": ids["experimentId"],
            "policyVersion": ids["policyVersion"],
            "grantId": grant["id"],
            "source": "synthetic",
            "startedAt": now,
            "endedAt": now,
            "status": "ok",
            "metrics": {"latency_ms": 4},
            "checks": {"passed": True},
            "steps": [
                {
                    "id": "read_1",
                    "kind": "tool",
                    "name": "read_records",
                    "status": "ok",
                    "attributes": {"rows": 1},
                }
            ],
            "content": {"request": "Synthetic curls at 40 lb", "scan": {"lean_mass": 40}},
            "redactorVersion": "d" * 64,
        }
        yield admin, sdk, app, base, key, grant, trace


def enable_content(admin, base):
    response = admin.put(
        base + "/settings",
        json={"content_categories": ["conversation", "body_scans"]},
    )
    assert response.status_code == 200, response.text


def test_keep_default_automatic_versions_and_partial_projection(feed):
    admin, sdk, app, base, _, _, trace = feed
    assert admin.get("/api/applications").json()[0]["settings"]["retention_days"] is None
    result = sdk.post("/v2/traces", json=trace)
    assert result.status_code == 201, result.text
    assert "content.scan" not in result.json()["coverage"]
    assert admin.get(base + "/traces").json()[0]["metrics"] == {"latency_ms": 4}
    assert trace["id"] in admin.get(base + "/traces/" + trace["id"] + "/content").json()["content"]
    identical = sdk.post(
        "/v2/connect", json={"policy": policy(), "experiment": experiment()}
    ).json()
    assert identical["experimentId"] == trace["experimentId"]
    changed = policy()
    changed["metrics"]["provider_attempts"] = {
        "semanticId": "provider.attempts",
        "definitionVersion": 1,
        "unit": "count",
    }
    ids = sdk.post("/v2/connect", json={"policy": changed, "experiment": experiment()}).json()
    assert ids["policyVersion"] != trace["policyVersion"]
    evolved = {
        **trace,
        "id": str(uuid4()),
        "policyVersion": ids["policyVersion"],
        "experimentId": ids["experimentId"],
        "metrics": {"latency_ms": 2, "provider_attempts": "invalid"},
    }
    response = sdk.post("/v2/traces", json=evolved)
    assert response.status_code == 201
    row = admin.get(base + "/traces/" + evolved["id"]).json()["trace"]
    assert row["metrics"] == {"latency_ms": 2, "provider_attempts": None}
    assert row["coverage"]["metrics.provider_attempts"] == "invalid_value"
    with app.state.session_factory() as session:
        assert all(
            row.expires == 0
            for row in session.scalars(
                select(FeedObjectRecord).where(FeedObjectRecord.kind == "trace2")
            )
        )


def test_content_read_boundary_redaction_and_withdrawal(feed):
    admin, sdk, app, base, _, grant, trace = feed
    enable_content(admin, base)
    assert sdk.post("/v2/traces", json=trace).status_code == 201
    private = admin.get(base + "/traces/" + trace["id"] + "/content").json()
    assert private["content"][trace["id"]]["scan"] == {"lean_mass": 40}
    leaked = {**trace, "id": str(uuid4()), "content": {"request": "person@example.invalid"}}
    assert (
        sdk.post("/v2/traces", json=leaked).json()["coverage"]["content.request"]
        == "redaction_failed"
    )
    with app.state.session_factory() as session:
        assert all(
            "person@example.invalid" not in str(row.body)
            for row in session.scalars(select(FeedObjectRecord))
        )
    app.state.settings.operator_allowlist[SUBJECT] = {
        "email": EMAIL,
        "role": "viewer",
        "resources": [base.rsplit("/", 1)[-1]],
    }
    assert admin.get(base + "/traces").status_code == 200
    assert admin.get(base + "/traces/" + trace["id"] + "/content").status_code == 403
    assert sdk.get(base + "/traces").status_code == 403
    assert sdk.delete("/v2/grants/" + grant["id"]).status_code == 200
    assert admin.get(base + "/traces").json() == []
    assert sdk.post("/v2/grants", json=grant).status_code == 409
    assert sdk.post("/v2/traces", json=trace).status_code == 403


def test_outcomes_original_policy_idempotency_and_erase(feed):
    admin, sdk, _, base, _, grant, trace = feed
    enable_content(admin, base)
    assert sdk.post("/v2/traces", json=trace).status_code == 201
    event = {
        "schemaVersion": 2,
        "id": str(uuid4()),
        "traceId": trace["id"],
        "policyVersion": trace["policyVersion"],
        "occurredAt": trace["endedAt"],
        "name": "proposal_decision",
        "attributes": {"decision": "dismissed"},
        "content": {"request": "Synthetic correction"},
        "redactorVersion": "d" * 64,
    }
    assert sdk.post("/v2/outcomes", json=event).status_code == 201
    assert sdk.post("/v2/outcomes", json=event).status_code == 201
    assert (
        sdk.post("/v2/outcomes", json={**event, "attributes": {"decision": "applied"}}).status_code
        == 409
    )
    assert sdk.post("/v2/outcomes", json={**event, "policyVersion": "e" * 64}).status_code == 409
    report = admin.get(base + "/traces/" + trace["id"] + "/content").json()
    assert len(report["outcomes"]) == 1 and len(report["content"]) == 2
    assessment = {"id": str(uuid4()), "scorerHash": "f" * 64, "ratings": {"grounded": "unknown"}}
    assert (
        admin.post(base + "/traces/" + trace["id"] + "/assessments", json=assessment).status_code
        == 201
    )
    assert admin.delete(base + "/content").status_code == 200
    assert sdk.post("/v2/traces", json=trace).status_code == 201
    assert admin.get(base + "/traces/" + trace["id"] + "/content").json()["content"] == {}
    assert sdk.delete("/v2/grants/" + grant["id"]).status_code == 200
    assert sdk.post("/v2/outcomes", json=event).status_code == 410


def test_key_overlap_expiry_and_app_boundaries(feed):
    admin, sdk, app, base, key, _, trace = feed
    declaration = sdk.get("/v2/policies/" + trace["policyVersion"])
    assert declaration.status_code == 200
    assert declaration.json()["schemaVersion"] == 2
    now = int(time.time() * 1000)
    rotation = admin.post(
        base + "/keys/" + key["id"] + "/rotate",
        json={"expiresAt": now + 100000, "retireAt": now + 10000},
    )
    assert rotation.status_code == 200, rotation.text
    assert sdk.post("/v2/traces", json=trace).status_code == 201
    with app.state.session_factory() as session:
        old = session.get(ApplicationKeyRecord, key["id"])
        old.retire_at = time.time() - 1
        session.commit()
    assert sdk.post("/v2/traces", json=trace).status_code == 401
    sdk.headers["authorization"] = "Bearer " + rotation.json()["token"]
    assert sdk.post("/v2/traces", json=trace).status_code == 201
    assert sdk.post("/api/applications", json={}).status_code == 403
    assert sdk.get("/api/catalog").status_code == 403
    assert sdk.post("/v1/traces", json=trace).status_code == 403
    assert sdk.post("/v2/traces", json=trace, headers={"origin": ORIGIN}).status_code == 403
    other = str(uuid4())
    assert admin.post("/api/applications", json={"id": other, "name": "Other"}).status_code == 201
    other_key = admin.post(
        f"/api/applications/{other}/keys", json={"expiresAt": now + 100000}
    ).json()
    sdk.headers["authorization"] = "Bearer " + other_key["token"]
    assert sdk.get("/v2/policies/" + trace["policyVersion"]).status_code == 404
    assert sdk.post("/v2/traces", json=trace).status_code == 403


def test_key_lifespans_are_bounded_and_never_is_explicit_and_revocable(feed):
    admin, sdk, app, base, _, _, trace = feed
    now, day = int(time.time() * 1000), 86400000
    policy_path = "/v2/policies/" + trace["policyVersion"]

    def issue(body):
        return admin.post(base + "/keys", json=body)

    for days in (7, 30, 90, 365):
        dated = issue({"expiresAt": now + days * day})
        assert dated.status_code == 201, dated.text
        assert dated.json()["expiresAt"] == now + days * day
    assert issue({"expiresAt": now - 1}).status_code == 400
    assert issue({"expiresAt": now + 366 * day}).status_code == 400
    # Omitting the field never means "no expiry"; only an explicit null does.
    assert issue({}).status_code == 422
    assert issue({"expiresAt": "never"}).status_code == 422

    never = issue({"expiresAt": None})
    assert never.status_code == 201, never.text
    assert never.json()["expiresAt"] is None
    listed = {key["id"]: key for key in admin.get(base + "/keys").json()}
    assert listed[never.json()["id"]]["expiresAt"] is None
    with app.state.session_factory() as session:
        assert session.get(ApplicationKeyRecord, never.json()["id"]).expires == 0
    auth = {"authorization": "Bearer " + never.json()["token"]}
    assert sdk.get(policy_path, headers=auth).status_code == 200

    # A never-expiring key still rotates within a bounded overlap.
    rotate = base + "/keys/" + never.json()["id"] + "/rotate"
    assert (
        admin.post(rotate, json={"expiresAt": None, "retireAt": now + 366 * day}).status_code == 400
    )
    replacement = admin.post(rotate, json={"expiresAt": None, "retireAt": now + 3600000})
    assert replacement.status_code == 200, replacement.text
    assert replacement.json()["expiresAt"] is None
    assert sdk.get(policy_path, headers=auth).status_code == 200
    with app.state.session_factory() as session:
        session.get(ApplicationKeyRecord, never.json()["id"]).retire_at = time.time() - 1
        session.commit()
    assert sdk.get(policy_path, headers=auth).status_code == 401

    # And revocation ends one immediately.
    auth = {"authorization": "Bearer " + replacement.json()["token"]}
    assert sdk.get(policy_path, headers=auth).status_code == 200
    revoked = admin.post(base + "/keys/" + replacement.json()["id"] + "/revoke")
    assert revoked.status_code == 200
    assert sdk.get(policy_path, headers=auth).status_code == 401

    created = admin.post(
        "/api/applications", json={"name": "No expiry", "key": {"expiresAt": None}}
    )
    assert created.status_code == 201, created.text
    assert created.json()["key"]["expiresAt"] is None


def test_production_gate_and_unknown_withdrawal_tombstone(feed):
    admin, sdk, _, base, _, _, trace = feed
    # Production is enabled by default, but the source is immutable per experiment.
    assert sdk.post("/v2/traces", json={**trace, "source": "production"}).status_code == 403
    unknown = str(uuid4())
    assert sdk.delete("/v2/grants/" + unknown).status_code == 200
    assert sdk.post("/v2/grants", json={"id": unknown, "source": "synthetic"}).status_code == 409
    connected = sdk.post(
        "/v2/connect", json={"source": "production", "policy": policy(), "experiment": experiment()}
    ).json()
    assert connected["experimentId"] != trace["experimentId"]
    grant = {"id": str(uuid4()), "source": "production"}
    assert sdk.post("/v2/grants", json=grant).status_code == 201
    production = {
        **trace,
        "id": str(uuid4()),
        "source": "production",
        "grantId": grant["id"],
        "experimentId": connected["experimentId"],
    }
    assert sdk.post("/v2/traces", json=production).status_code == 201
    assert admin.put(base + "/settings", json={"production_enabled": False}).status_code == 200
    assert sdk.post("/v2/traces", json={**production, "id": str(uuid4())}).status_code == 403
    assert sdk.delete("/v2/grants/" + grant["id"]).status_code == 200


def test_retention_only_shortens_and_content_never_resurrects(feed):
    admin, sdk, app, base, _, _, trace = feed
    enable_content(admin, base)
    assert sdk.post("/v2/traces", json=trace).status_code == 201
    config = {
        "retention_days": 10,
        "content_retention_days": 1,
        "content_categories": ["conversation", "body_scans"],
    }
    assert admin.put(base + "/settings", json=config).status_code == 200
    with app.state.session_factory() as session:
        row = session.get(FeedObjectRecord, (base.rsplit("/", 1)[-1], "trace2", trace["id"]))
        deadline = row.expires
        assert deadline == trace["startedAt"] + 10 * 86400000
    assert admin.put(base + "/settings", json={**config, "retention_days": None}).status_code == 200
    with app.state.session_factory() as session:
        row = session.get(FeedObjectRecord, (base.rsplit("/", 1)[-1], "trace2", trace["id"]))
        assert row.expires == deadline
        with pytest.raises(DatabaseError):
            session.execute(text("UPDATE feed_objects SET expires=0 WHERE kind='trace2'"))
        session.rollback()
        with pytest.raises(DatabaseError):
            session.execute(text("UPDATE feed_objects SET body='{}' WHERE kind='trace2'"))


def test_finalized_comparison_across_policy_versions_and_run_identity(feed):
    admin, sdk, _, base, _, _, trace = feed
    dataset = {"schemaVersion": 1, "caseIds": ["a" * 64], "rubricHash": "b" * 64}
    dataset_hash = admin.post(base + "/datasets", json=dataset).json()["hash"]
    candidate = {**experiment(), "mode": "scripted", "datasetHash": "f" * 64, "runId": str(uuid4())}
    assert (
        sdk.post("/v2/connect", json={"policy": policy(), "experiment": candidate}).status_code
        == 409
    )
    candidate["datasetHash"] = dataset_hash
    runs = []
    for index in range(2):
        changed = copy.deepcopy(policy())
        if index:
            changed["metrics"]["duration_ms"] = changed["metrics"].pop("latency_ms")
        connected = sdk.post(
            "/v2/connect",
            json={"policy": changed, "experiment": {**candidate, "runId": str(uuid4())}},
        ).json()
        runs.append(connected["experimentId"])
        item = {
            **trace,
            "id": str(uuid4()),
            "caseId": "a" * 64,
            "experimentId": connected["experimentId"],
            "policyVersion": connected["policyVersion"],
            "metrics": {"duration_ms" if index else "latency_ms": 5},
            "status": "partial" if index else "ok",
        }
        assert sdk.post("/v2/traces", json=item).status_code == 201
    compared = admin.get(base + f"/comparisons/{runs[0]}/{runs[1]}")
    available = admin.get(base + "/experiments", params={"evaluations_only": True}).json()
    assert [row["id"] for row in available] == sorted(runs)
    remaining = admin.get(
        base + "/experiments", params={"evaluations_only": True, "after": available[0]["id"]}
    ).json()
    assert [row["id"] for row in remaining] == [available[1]["id"]]
    assert compared.status_code == 200, compared.text
    assert all(field["compatible"] for field in compared.json()["fields"])
    assert compared.json()["cases"][0]["afterStatus"] == "partial"
    assert sdk.post("/v2/traces", json={**item, "id": str(uuid4())}).status_code == 201
    assert admin.get(base + f"/comparisons/{runs[0]}/{runs[1]}").status_code == 409


def test_bounded_schema_sanitized_validation_and_payload_limit(feed):
    _, sdk, _, _, _, _, trace = feed
    invalid = policy()
    invalid["steps"]["read_records"]["attributes"]["raw"] = {"type": "string"}
    result = sdk.post("/v2/connect", json={"policy": invalid, "experiment": experiment()})
    assert result.status_code == 422 and result.json() == {"detail": "Invalid request"}
    assert sdk.post("/v2/traces", json={**trace, "raw": "not allowed"}).status_code == 422
    assert (
        sdk.post("/v2/traces", json={**trace, "content": {"request": "x" * 262145}}).status_code
        == 413
    )
    assert sdk.post("/v2/traces", json={**trace, "metrics": {"undeclared": 1}}).status_code == 400


def test_first_policy_accepts_categories_only_once_and_create_is_minimal(feed):
    admin, sdk, _, base, _, _, trace = feed
    created = admin.post(
        "/api/applications",
        json={"name": "Minimal", "key": {"expiresAt": int(time.time() * 1000) + 60000}},
    )
    assert created.status_code == 201, created.text
    assert created.json()["key"]["token"].startswith("ae_")
    config = next(
        item for item in admin.get("/api/applications").json() if item["id"] == base.split("/")[-1]
    )["settings"]
    assert config == {
        "production_enabled": True,
        "retention_days": None,
        "content_retention_days": None,
        "content_categories": ["body_scans", "conversation"],
    }
    changed = policy()
    changed["content"]["notes"] = {"category": "health_notes", "valueSchema": {"type": "string"}}
    connected = sdk.post("/v2/connect", json={"policy": changed, "experiment": experiment()}).json()
    item = {
        **trace,
        "id": str(uuid4()),
        "experimentId": connected["experimentId"],
        "policyVersion": connected["policyVersion"],
        "content": {"notes": "Synthetic note"},
    }
    assert sdk.post("/v2/traces", json=item).json()["coverage"]["content.notes"] == "not_authorized"
    assert admin.put(base + "/settings", json={"content_categories": []}).status_code == 200
    sdk.post("/v2/connect", json={"policy": policy(), "experiment": experiment()})
    assert (
        sdk.post("/v2/traces", json={**trace, "id": str(uuid4())}).json()["coverage"][
            "content.scan"
        ]
        == "not_authorized"
    )


def test_expired_receipt_prevents_recreation_and_outcome_content_expiry(feed, monkeypatch):
    from autoeval_api.services import application_feed as service

    admin, sdk, app, base, _, _, trace = feed
    config = {
        "retention_days": 10,
        "content_retention_days": 1,
        "content_categories": ["conversation", "body_scans"],
    }
    assert admin.put(base + "/settings", json=config).status_code == 200
    assert sdk.post("/v2/traces", json=trace).status_code == 201
    future = trace["startedAt"] + 2 * 86400000
    monkeypatch.setattr(service, "now_ms", lambda: future)
    event = {
        "schemaVersion": 2,
        "id": str(uuid4()),
        "traceId": trace["id"],
        "policyVersion": trace["policyVersion"],
        "occurredAt": future,
        "name": "proposal_decision",
        "attributes": {"decision": "applied"},
        "content": {"request": "Synthetic late content"},
        "redactorVersion": "d" * 64,
    }
    response = sdk.post("/v2/outcomes", json=event)
    assert response.status_code == 201, response.text
    assert response.json()["coverage"] == {"content.request": "retention_expired"}
    with app.state.session_factory() as session:
        assert session.get(FeedObjectRecord, (base.split("/")[-1], "content2", event["id"])) is None
    # Relaxing retention cannot extend the root's original content deadline either.
    assert (
        admin.put(base + "/settings", json={**config, "content_retention_days": None}).status_code
        == 200
    )
    assert (
        sdk.post("/v2/outcomes", json={**event, "id": str(uuid4())}).json()["coverage"][
            "content.request"
        ]
        == "retention_expired"
    )
    assert admin.put(base + "/settings", json={**config, "retention_days": 1}).status_code == 200
    assert admin.get(base + "/traces").json() == []
    assert (
        admin.put(
            base + "/settings", json={"content_categories": config["content_categories"]}
        ).status_code
        == 200
    )
    assert sdk.post("/v2/traces", json=trace).status_code == 410
    with app.state.session_factory() as session:
        assert (
            session.get(FeedObjectRecord, (base.split("/")[-1], "receipt2", trace["id"]))
            is not None
        )


def test_large_numbers_omit_only_invalid_fields(feed):
    admin, sdk, _, base, _, _, trace = feed
    body = {
        **trace,
        "metrics": {"latency_ms": 10**400},
        "content": {"scan": {"lean_mass": 10**400}},
    }
    response = sdk.post("/v2/traces", json=body)
    assert response.status_code == 201, response.text
    assert response.json()["coverage"]["metrics.latency_ms"] == "invalid_value"
    assert response.json()["coverage"]["content.scan"] == "invalid_value"
    stored = admin.get(base + "/traces").json()[0]
    assert stored["metrics"]["latency_ms"] is None and stored["checks"]["passed"] is True


def test_postgres_withdrawal_serializes_with_inflight_capture(feed):
    import threading

    from autoeval_api.services import application_contract as contract
    from autoeval_api.services import application_feed as service

    admin, sdk, app, base, _, grant, trace = feed
    factory = app.state.session_factory
    with factory() as session:
        if session.get_bind().dialect.name != "postgresql":
            pytest.skip("PostgreSQL row-lock behavior")
    started, finished, failures = threading.Event(), threading.Event(), []

    def withdraw():
        try:
            with factory() as session:
                started.set()
                resource = service.resource(
                    session, {"role": "admin"}, base.split("/")[-1], write=True
                )
                service.revoke_grant(session, resource, grant["id"])
                session.commit()
        except Exception as error:
            failures.append(type(error).__name__)
        finally:
            finished.set()

    with factory() as session:
        resource = service.resource(session, {"role": "admin"}, base.split("/")[-1], write=True)
        worker = threading.Thread(target=withdraw)
        worker.start()
        assert started.wait(2)
        assert not finished.wait(0.05)
        service.ingest(session, resource, contract.Observation.model_validate(trace))
        session.commit()
    worker.join(3)
    assert not worker.is_alive() and not failures
    assert admin.get(base + "/traces").json() == []
    assert sdk.post("/v2/traces", json=trace).status_code == 403


def test_invalid_unicode_content_is_omitted(feed):
    import json

    _, sdk, _, _, _, _, trace = feed
    body = {**trace, "content": {"request": "\ud800"}}
    response = sdk.post(
        "/v2/traces", content=json.dumps(body), headers={"content-type": "application/json"}
    )
    assert response.status_code == 201, response.text
    assert response.json()["coverage"]["content.request"] == "invalid_value"


def test_sqlite_withdrawal_serializes_with_inflight_capture(tmp_path):
    import threading

    from sqlalchemy import create_engine

    from autoeval_api.db import build_session_factory
    from autoeval_api.migration_cli import upgrade
    from autoeval_api.services import application_contract as contract
    from autoeval_api.services import application_feed as service

    engine = create_engine(f"sqlite:///{tmp_path}/race.db")
    upgrade(engine)
    factory = build_session_factory(engine)
    app_id, grant_id = str(uuid4()), str(uuid4())
    principal = {"role": "admin"}
    with factory() as session:
        service.create_application(
            session, principal, contract.ApplicationInput(id=app_id, name="Race")
        )
        session.commit()
    with factory() as session:
        app = service.resource(session, principal, app_id)
        ids = service.connect(
            session,
            app,
            contract.Connection(
                policy=contract.Policy.model_validate(policy()),
                experiment=contract.Experiment.model_validate(experiment()),
            ),
        )
        service.grant(session, app, contract.Grant(id=grant_id, source="synthetic"))
        session.commit()
    started, finished, failures = threading.Event(), threading.Event(), []

    def withdraw():
        try:
            with factory() as session:
                started.set()
                app = service.resource(session, principal, app_id, write=True)
                service.revoke_grant(session, app, grant_id)
                session.commit()
        except Exception as error:
            failures.append(type(error).__name__)
        finally:
            finished.set()

    with factory() as session:
        app = service.resource(session, principal, app_id)
        service.consent_for(session, app, grant_id, "synthetic")
        worker = threading.Thread(target=withdraw)
        worker.start()
        assert started.wait(2) and not finished.wait(0.05)
        now = service.now_ms()
        trace = contract.Observation(
            schemaVersion=2,
            id=str(uuid4()),
            experimentId=ids["experimentId"],
            policyVersion=ids["policyVersion"],
            grantId=grant_id,
            source="synthetic",
            startedAt=now,
            endedAt=now,
            status="ok",
        )
        service.ingest(session, app, trace)
        session.commit()
    worker.join(3)
    assert not worker.is_alive() and not failures
    with factory() as session:
        assert service.observations(session, app_id) == []
        assert session.get(FeedObjectRecord, (app_id, "grant2", grant_id)).revoked
    engine.dispose()


def test_settings_precondition_and_retention_edit_before_first_policy(feed):
    admin, sdk, _, base, _, _, _ = feed
    state = next(
        item for item in admin.get("/api/applications").json() if item["id"] == base.split("/")[-1]
    )
    assert (
        admin.put(
            base + "/settings",
            json={**state["settings"], "production_enabled": False},
            headers={"if-match": state["settingsVersion"]},
        ).status_code
        == 200
    )
    assert (
        admin.put(
            base + "/settings",
            json=state["settings"],
            headers={"if-match": state["settingsVersion"]},
        ).status_code
        == 409
    )
    created = admin.post(
        "/api/applications",
        json={"name": "First policy later", "key": {"expiresAt": int(time.time() * 1000) + 60000}},
    ).json()
    newbase = "/api/applications/" + created["id"]
    assert admin.put(newbase + "/settings", json={"retention_days": 90}).status_code == 200
    sdk.headers["authorization"] = "Bearer " + created["key"]["token"]
    connected = sdk.post("/v2/connect", json={"policy": policy(), "experiment": experiment()})
    assert connected.json()["settings"]["content_categories"] == ["body_scans", "conversation"]


def test_category_discovery_pages_beyond_one_hundred_versions(feed):
    admin, sdk, _, base, _, _, _ = feed
    for index in range(101):
        changed = policy()
        changed["content"]["added"] = {
            "category": f"scope_{index}",
            "valueSchema": {"type": "boolean"},
        }
        assert (
            sdk.post(
                "/v2/connect", json={"policy": changed, "experiment": experiment()}
            ).status_code
            == 200
        )
    first = admin.get(base + "/policy-categories").json()
    assert len(first) == 100
    second = admin.get(base + "/policy-categories", params={"after": first[-1]["id"]}).json()
    assert len(second) == 2
    assert set(item["id"] for item in first).isdisjoint(item["id"] for item in second)
    assert {f"scope_{index}" for index in range(101)} <= {
        category for item in [*first, *second] for category in item["categories"]
    }
