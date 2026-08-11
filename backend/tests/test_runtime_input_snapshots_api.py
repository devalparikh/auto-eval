from datetime import UTC, datetime

import pytest
from sqlalchemy.exc import DatabaseError

from autoeval_api.models import AgentSystemRecord, RuntimeInputSnapshotRecord, TraceRecord
from autoeval_api.services.runtime_input_snapshots import (
    create_runtime_input_snapshot,
    resolve_runtime_input_snapshot,
    validate_runtime_input_snapshot_map,
)


def _create_snapshot(
    session,
    owner,
    *,
    synthetic: bool,
    label: str,
    source_trace_id: str | None = None,
    node_id: str = "load_portfolio_market_data",
):
    marker = "SYNTHETIC_CONTRACT" if synthetic else "REAL_SECRET_CONTRACT"
    return create_runtime_input_snapshot(
        session,
        owner,
        source_trace_id=source_trace_id,
        node_id=node_id,
        source_key="options_chain",
        schema_version=1,
        label=label,
        observed_at=datetime(2026, 8, 10, 15, tzinfo=UTC),
        fetched_at=datetime(2026, 8, 10, 15, 1, tzinfo=UTC),
        provider="synthetic" if synthetic else "private-provider",
        source_kind="seed_fixture" if synthetic else "live_fetch",
        is_synthetic=synthetic,
        payload={
            "REAL_SECRET_ACCOUNT": {"account_number": "REAL_ACCOUNT_123"},
            "contracts": [
                {
                    "provider_contract_id": marker,
                    "symbol": "SYNTH" if synthetic else "PRIVATE_SYMBOL",
                    "bid": 12.34 if synthetic else 9876.54,
                }
            ],
        },
        provenance={
            "provider": "synthetic" if synthetic else "private-provider",
            "as_of": "2026-08-10T15:00:00Z",
            "fetched_at": "2026-08-10T15:01:00Z",
            "contract_count": 1,
            "provider_ref": marker,
            "request_params": {"symbols": ["SYNTH" if synthetic else "PRIVATE_SYMBOL"]},
            "freshness": {"status": "fresh", "age_seconds": 60},
        },
    )


def test_runtime_input_snapshot_list_detail_and_artifact_projection(
    client,
    session_factory,
) -> None:
    session = session_factory()
    owner = session.query(AgentSystemRecord).filter_by(key="incident-triage").one()
    synthetic = _create_snapshot(session, owner, synthetic=True, label="Synthetic options")
    real = _create_snapshot(session, owner, synthetic=False, label="Real options")
    owner_id = owner.id
    session.close()

    listing = client.get(
        f"/api/agent-systems/{owner_id}/runtime-input-snapshots",
        params={"source_key": "options_chain"},
    )
    synthetic_detail = client.get(f"/api/runtime-input-snapshots/{synthetic.id}")
    real_detail = client.get(f"/api/runtime-input-snapshots/{real.id}")
    artifact_catalog = client.get(f"/api/agent-systems/{owner_id}/artifacts")
    real_artifact = client.get(f"/api/artifacts/runtime_input/{real.id}")
    generic_artifact = client.get(f"/api/artifacts/node_snapshot/{real.id}")

    assert listing.status_code == 200
    assert {item["id"] for item in listing.json()} == {synthetic.id, real.id}
    assert all("payload" not in item for item in listing.json())
    assert (
        synthetic_detail.json()["content"]["contracts"][0]["provider_contract_id"]
        == "SYNTHETIC_CONTRACT"
    )
    assert real_detail.status_code == 200
    assert real_detail.json()["content"]["shape"]["type"] == "object"
    assert real_detail.json()["provenance"]["contract_count"] == 1
    for secret in (
        "REAL_SECRET_ACCOUNT",
        "REAL_ACCOUNT_123",
        "REAL_SECRET_CONTRACT",
        "PRIVATE_SYMBOL",
        "9876.54",
    ):
        assert secret not in real_detail.text
        assert secret not in real_artifact.text
        assert secret not in generic_artifact.text
    assert "provider_ref" not in real_detail.json()["provenance"]
    assert "request_params" not in real_detail.json()["provenance"]
    assert any(
        artifact["id"] == real.id and artifact["kind"] == "node_snapshot"
        for artifact in artifact_catalog.json()["artifacts"]
    )


def test_runtime_input_snapshot_resolution_validates_policy_and_hash(session_factory) -> None:
    session = session_factory()
    owner = session.query(AgentSystemRecord).filter_by(key="incident-triage").one()
    record = _create_snapshot(session, owner, synthetic=True, label="Synthetic options")

    resolved, payload = resolve_runtime_input_snapshot(
        session,
        record.id,
        owner_system_key=owner.key,
        source_key="options_chain",
        node_id="load_portfolio_market_data",
        schema_version=1,
    )

    assert resolved.id == record.id
    assert payload == record.payload
    payload["contracts"] = []
    assert record.payload["contracts"]
    with pytest.raises(ValueError, match="schema_version"):
        resolve_runtime_input_snapshot(
            session,
            record.id,
            owner_system_key=owner.key,
            source_key="options_chain",
            node_id="load_portfolio_market_data",
            schema_version=2,
        )
    with pytest.raises(ValueError, match="another agent system"):
        resolve_runtime_input_snapshot(
            session,
            record.id,
            owner_system_key="portfolio-query",
            source_key="options_chain",
            node_id="load_portfolio_market_data",
            schema_version=1,
        )
    with pytest.raises(ValueError, match="source_key"):
        resolve_runtime_input_snapshot(
            session,
            record.id,
            owner_system_key=owner.key,
            source_key="another_source",
            node_id="load_portfolio_market_data",
            schema_version=1,
        )
    record.payload = {"tampered": True}
    with pytest.raises(ValueError, match="content-hash"):
        resolve_runtime_input_snapshot(
            session,
            record.id,
            owner_system_key=owner.key,
            source_key="options_chain",
            node_id="load_portfolio_market_data",
            schema_version=1,
        )
    session.rollback()


def test_runtime_input_snapshots_are_database_immutable(session_factory) -> None:
    session = session_factory()
    owner = session.query(AgentSystemRecord).filter_by(key="incident-triage").one()
    record = _create_snapshot(session, owner, synthetic=True, label="Synthetic options")
    record.label = "Changed"

    with pytest.raises(DatabaseError, match="runtime_input_snapshot_immutable"):
        session.commit()
    session.rollback()
    record = session.get(RuntimeInputSnapshotRecord, record.id)
    session.delete(record)
    with pytest.raises(DatabaseError, match="runtime_input_snapshot_immutable"):
        session.commit()


def test_dataset_item_rejects_invalid_runtime_snapshot_bindings(
    client,
    session_factory,
) -> None:
    session = session_factory()
    owner = session.query(AgentSystemRecord).filter_by(key="incident-triage").one()
    snapshot = _create_snapshot(session, owner, synthetic=True, label="Synthetic options")
    owner_id = owner.id
    with pytest.raises(ValueError, match="another agent system"):
        validate_runtime_input_snapshot_map(
            session,
            "another-agent-system",
            {"load_portfolio_market_data": snapshot.id},
        )
    session.close()
    catalog = client.get("/api/catalog").json()
    dataset = next(item for item in catalog["datasets"] if item["agent_system_id"] == owner_id)
    draft = next(item for item in dataset["versions"] if item["status"] == "draft")
    payload = {
        "input": {"text": "Checkout is failing."},
        "expected": {"severity": "high"},
    }

    missing = client.post(
        f"/api/dataset-versions/{draft['id']}/items",
        json={
            **payload,
            "runtime_input_snapshot_ids": {"load_portfolio_market_data": "missing"},
        },
    )
    wrong_node = client.post(
        f"/api/dataset-versions/{draft['id']}/items",
        json={
            **payload,
            "runtime_input_snapshot_ids": {"another_node": snapshot.id},
        },
    )
    assert missing.status_code == 409
    assert "not found" in missing.json()["detail"]
    assert wrong_node.status_code == 409
    assert "belongs to node load_portfolio_market_data" in wrong_node.json()["detail"]


def test_trace_to_dataset_and_clone_preserve_runtime_snapshot_bindings(
    client,
    session_factory,
) -> None:
    trace = client.post(
        "/api/traces/run",
        json={
            "model_id": "mock/incident-specialist",
            "input": {"text": "Checkout is failing.", "service": "checkout"},
        },
    ).json()
    session = session_factory()
    owner = session.query(AgentSystemRecord).filter_by(key="incident-triage").one()
    snapshot = _create_snapshot(
        session,
        owner,
        synthetic=True,
        label="Trace observation",
        source_trace_id=trace["id"],
        node_id="normalize_input",
    )
    trace_record = session.get(TraceRecord, trace["id"])
    trace_record.runtime_input_snapshot_ids = {"normalize_input": snapshot.id}
    session.commit()
    session.close()
    catalog = client.get("/api/catalog").json()
    dataset = catalog["datasets"][0]
    draft = next(item for item in dataset["versions"] if item["status"] == "draft")

    added = client.put(
        f"/api/dataset-versions/{draft['id']}/trace-items/{trace['id']}",
        json={"expected": trace["output"]},
    )
    cloned = client.post(
        f"/api/datasets/{dataset['id']}/versions",
        json={"clone_from_version_id": draft["id"]},
    )

    assert added.status_code == 201
    assert added.json()["runtime_input_snapshot_ids"] == {"normalize_input": snapshot.id}
    assert cloned.status_code == 201
    cloned_item = next(
        item for item in cloned.json()["items"] if item["source_trace_id"] == trace["id"]
    )
    assert cloned_item["runtime_input_snapshot_ids"] == {"normalize_input": snapshot.id}
