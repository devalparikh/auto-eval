from copy import deepcopy

import pytest
from sqlalchemy.exc import DatabaseError
from sqlalchemy.orm.attributes import set_committed_value

from autoeval_api.agent_systems.portfolio_analyst.seed import (
    ensure_seed_data as ensure_portfolio_seed_data,
)
from autoeval_api.agent_systems.portfolio_query.seed import (
    ensure_seed_data as ensure_query_seed_data,
)
from autoeval_api.models import (
    DatasetItemRecord,
    DatasetRecord,
    NodeOutputSnapshotRecord,
    PortfolioSnapshotRecord,
    RunStatus,
    TraceRecord,
    TraceSpanRecord,
    utc_now,
)
from autoeval_api.services.datasets import create_dataset_version
from autoeval_api.services.node_resources import resolve_node_resource


def test_node_snapshot_catalog_groups_state_and_observations_by_node(
    client,
    session_factory,
) -> None:
    session = session_factory()
    ensure_portfolio_seed_data(session)
    graph, prompt, dataset = ensure_query_seed_data(session)
    item = (
        session.query(DatasetItemRecord)
        .filter_by(dataset_version_id=dataset.id)
        .filter(DatasetItemRecord.runtime_input_snapshot_ids != {})
        .first()
    )
    assert item is not None
    runtime_snapshot_id = item.runtime_input_snapshot_ids["load_portfolio_market_data"]
    now = utc_now()
    trace = TraceRecord(
        status=RunStatus.COMPLETE,
        agent_system_version_id=graph.id,
        prompt_version_id=prompt.id,
        prompt_version_ids={},
        runtime_input_snapshot_ids={"load_portfolio_market_data": runtime_snapshot_id},
        node_snapshot_ids={"load_portfolio_market_data": runtime_snapshot_id},
        origin_type="evaluation",
        model_id="mock/portfolio-analyst",
        request_input=item.input,
        output={"status": "complete"},
        latency_ms=61,
        started_at=now,
        completed_at=now,
    )
    session.add(trace)
    session.flush()
    span = TraceSpanRecord(
        trace_id=trace.id,
        node_id="load_portfolio_market_data",
        node_kind="deterministic",
        runtime_input_snapshot_id=runtime_snapshot_id,
        node_snapshot_id=runtime_snapshot_id,
        snapshot_role="consumed",
        snapshot_resolution_mode="replayed",
        snapshot_metadata={"source": "options_chain", "schema_version": 1},
        sequence=3,
        status=RunStatus.COMPLETE,
        input={},
        output={"status": "fresh"},
        latency_ms=42,
        started_at=now,
        completed_at=now,
    )
    session.add(span)
    session.commit()
    session.close()

    response = client.get(
        "/api/node-snapshots",
        params={"product_key": "portfolio-analyst"},
    )

    assert response.status_code == 200
    records = response.json()
    assert {record["node_id"] for record in records} >= {
        "persist_portfolio_snapshot",
        "load_portfolio_market_data",
    }
    runtime = next(record for record in records if record["id"] == runtime_snapshot_id)
    assert runtime["snapshot_kind"] == "external_observation"
    assert runtime["latest_usage"]["resolution_mode"] == "replayed"
    assert runtime["latest_usage"]["latency_ms"] == 42
    assert runtime["latest_usage"]["agent_system_key"] == "portfolio-query"

    detail = client.get(f"/api/node-snapshots/{runtime_snapshot_id}")

    assert detail.status_code == 200
    payload = detail.json()
    assert payload["node_metadata"]["output_contract"] == "options_chain"
    assert payload["usages"][0]["role"] == "consumed"
    assert payload["usages"][0]["metadata"]["trace_latency_ms"] == 61
    assert payload["content_available"] is True

    current_resources = client.get(
        "/api/node-snapshots",
        params={
            "agent_system_key": "portfolio-analyst",
            "node_id": "persist_portfolio_snapshot",
            "output_key": "portfolio_state",
            "schema_version": 1,
            "snapshot_kind": "state",
            "latest_per_identity": True,
        },
    )
    assert current_resources.status_code == 200
    current_payload = current_resources.json()
    identities = [record["resource_identity"] for record in current_payload]
    assert len(identities) == len(set(identities))
    assert all(record["node_id"] == "persist_portfolio_snapshot" for record in current_payload)
    assert all(record["snapshot_kind"] == "state" for record in current_payload)


def test_generic_node_snapshot_catalog_is_database_immutable(session_factory) -> None:
    session = session_factory()
    ensure_query_seed_data(session)
    record = session.query(NodeOutputSnapshotRecord).first()
    assert record is not None
    record.label = "Changed"

    with pytest.raises(DatabaseError, match="node_output_snapshot_immutable"):
        session.commit()


def test_locked_node_resource_enforces_the_full_producer_contract(session_factory) -> None:
    session = session_factory()
    graph, _prompt, dataset = ensure_query_seed_data(session)
    item = session.query(DatasetItemRecord).filter_by(dataset_version_id=dataset.id).first()
    assert item is not None
    selection = item.node_resource_selections["get_indexed_portfolio"]
    policy = next(
        node["resource_policy"]
        for node in graph.definition["nodes"]
        if node["id"] == "get_indexed_portfolio"
    )

    resolved = resolve_node_resource(
        session,
        consumer_system_key="portfolio-query",
        policy_value=policy,
        selection_value=selection,
    )
    assert resolved.snapshot_id == selection["snapshot_id"]

    invalid_values = (
        ("product_key", "incident-triage"),
        ("producer_system_key", "portfolio-query"),
        ("producer_node_id", "another_node"),
        ("producer_output_key", "another_output"),
        ("producer_snapshot_kind", "node_output"),
        ("schema_version", 2),
    )
    for field, value in invalid_values:
        invalid_policy = {**policy, field: value}
        with pytest.raises(ValueError):
            resolve_node_resource(
                session,
                consumer_system_key="portfolio-query",
                policy_value=invalid_policy,
                selection_value=selection,
            )

    domain = session.get(PortfolioSnapshotRecord, selection["snapshot_id"])
    assert domain is not None
    domain.document = {**deepcopy(domain.document), "as_of": "tampered"}
    with session.no_autoflush, pytest.raises(ValueError, match="content-hash"):
        resolve_node_resource(
            session,
            consumer_system_key="portfolio-query",
            policy_value=policy,
            selection_value=selection,
        )
    session.rollback()

    domain = session.get(PortfolioSnapshotRecord, selection["snapshot_id"])
    dataset_record = session.get(DatasetRecord, dataset.dataset_id)
    assert domain is not None
    assert dataset_record is not None
    set_committed_value(
        domain,
        "document",
        {**deepcopy(domain.document), "as_of": "tampered-before-clone"},
    )
    with pytest.raises(ValueError, match="content-hash"):
        create_dataset_version(
            session,
            dataset_record,
            clone_from_version_id=dataset.id,
        )
    session.rollback()
