def _completed_incident_trace(client) -> tuple[dict, dict]:
    input_value = {
        "text": "An access token leaked and was used without authorization.",
        "service": "identity",
    }
    response = client.post(
        "/api/traces/run",
        json={"input": input_value, "model_id": "mock/incident-specialist"},
    )
    assert response.status_code == 201
    trace = response.json()
    assert trace["status"] == "complete"
    return input_value, trace


def test_completed_run_input_can_be_saved_as_an_idempotent_sample(client) -> None:
    input_value, trace = _completed_incident_trace(client)
    path = f"/api/agent-systems/{trace['agent_system_id']}/input-samples"
    body = {"input": input_value, "source_trace_id": trace["id"]}

    first = client.post(path, json=body)
    second = client.post(path, json=body)

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json()["id"] == first.json()["id"]
    assert first.json()["input"] == input_value
    listed = client.get(path)
    assert listed.status_code == 200
    assert [sample["id"] for sample in listed.json()].count(first.json()["id"]) == 1


def test_input_sample_rejects_a_trace_from_another_agent_system(
    client,
    session_factory,
) -> None:
    from autoeval_api.models import AgentSystemRecord

    input_value, trace = _completed_incident_trace(client)
    session = session_factory()
    other = AgentSystemRecord(
        key="sample-test-other-system",
        name="Other system",
        description="Ownership boundary test.",
    )
    session.add(other)
    session.commit()
    other_id = other.id
    session.close()

    response = client.post(
        f"/api/agent-systems/{other_id}/input-samples",
        json={"input": input_value, "source_trace_id": trace["id"]},
    )

    assert response.status_code == 409
    assert "another agent system" in response.json()["detail"]
