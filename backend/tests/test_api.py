def test_trace_endpoint_returns_graph_and_spans(client) -> None:
    response = client.post(
        "/api/traces/run",
        json={
            "input": {
                "text": "An access token leaked and was used without authorization.",
                "service": "identity",
            },
            "model_id": "mock/incident-specialist",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["output"]["severity"] == "critical"
    assert len(payload["spans"]) == 4
    assert payload["graph_definition"]["entry_point"] == "normalize_input"
    assert set(payload["prompt_version_ids"]) == {
        "incident-triage-classification",
        "incident-triage-draft-response",
    }
    llm_spans = [span for span in payload["spans"] if span["node_kind"] == "llm"]
    assert {span["prompt_version_id"] for span in llm_spans} == set(
        payload["prompt_version_ids"].values()
    )


def test_final_dataset_rejects_mutation(client) -> None:
    catalog = client.get("/api/catalog").json()
    final_version = next(
        version for version in catalog["datasets"][0]["versions"] if version["status"] == "final"
    )

    response = client.post(
        f"/api/dataset-versions/{final_version['id']}/items",
        json={
            "input": {"text": "A new example"},
            "expected": {
                "severity": "medium",
                "route": "support",
                "requires_human": False,
            },
        },
    )

    assert response.status_code == 409
    assert "immutable" in response.json()["detail"]


def test_eval_run_scores_multiple_models(client) -> None:
    catalog = client.get("/api/catalog").json()
    final_version = next(
        version for version in catalog["datasets"][0]["versions"] if version["status"] == "final"
    )

    response = client.post(
        "/api/eval-runs",
        json={
            "dataset_version_id": final_version["id"],
            "model_ids": ["mock/incident-specialist", "mock/incident-fast"],
            "run_in_background": False,
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "complete"
    assert len(payload["results"]) == 2
    assert all("f1_macro" in result["metrics"] for result in payload["results"])
    assert set(payload["prompt_version_ids"]) == {
        "incident-triage-classification",
        "incident-triage-draft-response",
    }
