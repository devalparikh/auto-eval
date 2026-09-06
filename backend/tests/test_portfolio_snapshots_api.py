from autoeval_api.agent_systems.portfolio_analyst.seed import ensure_seed_data
from autoeval_api.models import AgentSystemRecord
from autoeval_api.services.portfolio_snapshots import create_portfolio_snapshot


def test_lists_synthetic_portfolio_snapshot_summaries_without_documents(
    client,
    session_factory,
) -> None:
    session = session_factory()
    ensure_seed_data(session)
    session.close()

    response = client.get(
        "/api/portfolio-snapshots",
        params={"agent_system_key": "portfolio-analyst", "synthetic_only": True},
    )

    assert response.status_code == 200
    snapshots = response.json()
    assert len(snapshots) == 2
    assert all(snapshot["is_synthetic"] is True for snapshot in snapshots)
    assert all(snapshot["position_count"] == 2 for snapshot in snapshots)
    assert all(len(snapshot["content_hash"]) == 64 for snapshot in snapshots)
    assert all("document" not in snapshot for snapshot in snapshots)
    assert '"shares":' not in response.text


def test_snapshot_list_rejects_an_unknown_owner(client) -> None:
    response = client.get(
        "/api/portfolio-snapshots",
        params={"agent_system_key": "unknown-system"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Agent system not found"


def test_snapshot_detail_exposes_full_synthetic_content(client, session_factory) -> None:
    session = session_factory()
    ensure_seed_data(session)
    session.close()

    listing = client.get(
        "/api/portfolio-snapshots",
        params={"agent_system_key": "portfolio-analyst", "synthetic_only": True},
    ).json()
    response = client.get(f"/api/portfolio-snapshots/{listing[0]['id']}")

    assert response.status_code == 200
    detail = response.json()
    assert detail["content_available"] is True
    assert detail["content"]["is_synthetic"] is True
    assert detail["content"]["positions"][0]["shares"] in {80, 200}


def test_snapshot_detail_redacts_real_position_values(client, session_factory) -> None:
    session = session_factory()
    ensure_seed_data(session)
    owner = session.query(AgentSystemRecord).filter_by(key="portfolio-analyst").one()
    create_portfolio_snapshot(
        session,
        owner,
        snapshot_id="real-redaction-test",
        label="Private portfolio",
        as_of="2026-08-10T16:00:00Z",
        source_kind="broker_import",
        is_synthetic=False,
        document={
            "schema_version": 1,
            "account_id": "private-account-123",
            "positions": [
                {
                    "symbol": "SECRET",
                    "shares": 12345,
                    "market_value": 987654.32,
                    "instrument_type": "equity",
                    "bucket": "core",
                    "do_not_touch": True,
                }
            ],
        },
    )
    session.close()

    response = client.get("/api/portfolio-snapshots/real-redaction-test")
    artifact_response = client.get("/api/artifacts/portfolio_snapshot/real-redaction-test")

    assert response.status_code == 200
    assert artifact_response.status_code == 200
    detail = response.json()
    assert detail["content"]["redaction"]["applied"] is True
    assert detail["content"]["positions"][0]["bucket"] == "core"
    assert "symbol" in detail["content"]["redaction"]["omitted_position_fields"]
    assert "shares" in detail["content"]["redaction"]["omitted_position_fields"]
    assert "private-account-123" not in response.text
    assert "SECRET" not in response.text
    assert "12345" not in response.text
    assert "987654" not in response.text
    assert "private-account-123" not in artifact_response.text
    assert "SECRET" not in artifact_response.text
    assert "12345" not in artifact_response.text


def test_catalog_exposes_portfolio_product_flow_metadata(
    client,
    session_factory,
) -> None:
    session = session_factory()
    ensure_seed_data(session)
    session.add(
        AgentSystemRecord(
            key="portfolio-query",
            name="Investment Portfolio Q&A",
            description="Synthetic portfolio questions.",
        )
    )
    session.commit()
    session.close()

    systems = client.get("/api/catalog").json()["agent_systems"]
    index_flow = next(system for system in systems if system["key"] == "portfolio-analyst")
    query_flow = next(system for system in systems if system["key"] == "portfolio-query")
    incident_triage = next(system for system in systems if system["key"] == "incident-triage")

    assert (index_flow["product_key"], index_flow["flow_key"], index_flow["flow_name"]) == (
        "portfolio-analyst",
        "index",
        "Index portfolio",
    )
    assert (query_flow["product_key"], query_flow["flow_key"], query_flow["flow_name"]) == (
        "portfolio-analyst",
        "query",
        "Query portfolio",
    )
    assert query_flow["input_editor"] == "node-resource-query"
    assert index_flow["input_editor"] == "json"
    assert incident_triage["input_editor"] == "json"
