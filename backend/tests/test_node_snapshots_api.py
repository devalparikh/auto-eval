import pytest
from sqlalchemy.exc import DatabaseError

from autoeval_api.agent_systems.portfolio_analyst.seed import (
    ensure_seed_data as ensure_portfolio_seed_data,
)
from autoeval_api.agent_systems.portfolio_query.seed import (
    ensure_seed_data as ensure_query_seed_data,
)
from autoeval_api.models import (
    DatasetItemRecord,
    NodeOutputSnapshotRecord,
    RunStatus,
    TraceRecord,
    TraceSpanRecord,
    utc_now,
)


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


def test_generic_node_snapshot_catalog_is_database_immutable(session_factory) -> None:
    session = session_factory()
    ensure_query_seed_data(session)
    record = session.query(NodeOutputSnapshotRecord).first()
    assert record is not None
    record.label = "Changed"

    with pytest.raises(DatabaseError, match="node_output_snapshot_immutable"):
        session.commit()
