import copy
import json

import pytest
from sqlalchemy import inspect

from autoeval_api.db import create_schema
from autoeval_api.services.harness_data import training_example
from autoeval_api.training.data import prepare_training_data

ROOT = "/api/harnesses/my-agent"


def connect(client):
    result = client.post(
        "/api/harnesses", json={"key": "my-agent", "name": "My agent", "harness": "pi"}
    )
    assert result.status_code == 201, result.text
    return result.json()


def task(client, key="train-task", partition="train"):
    result = client.post(
        f"{ROOT}/tasks",
        json={
            "key": key,
            "partition": partition,
            "prompt": f"Fix the bug in {key}",
            "repository_revision": "a" * 40,
            "test_command": ["python", "-m", "pytest"],
        },
    )
    assert result.status_code == 201, result.text
    return result.json()


def capture(task_key="train-task", **overrides):
    return {
        "request_id": task_key,
        "session_id": task_key,
        "task_key": task_key,
        "harness_revision": "pi@1.0",
        "configuration_hash": "a" * 64,
        "model": "model-a",
        "protocol": "chat",
        "latency_ms": 120,
        "request": {"messages": [{"role": "user", "content": f"Fix {task_key}"}]},
        "response": {
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {"role": "assistant", "content": "Fixed and tested."},
                }
            ]
        },
        **overrides,
    }


def approved(client, task_key):
    response = client.post(f"{ROOT}/captures", json=capture(task_key))
    assert response.status_code == 201, response.text
    identifier = response.json()["id"]
    response = client.post(f"{ROOT}/captures/{identifier}/review", json={"decision": "approved"})
    assert response.status_code == 200, response.text
    return identifier


def test_capture_review_training_roundtrip(client, session_factory):
    connected = connect(client)
    for key, partition in (("train-task", "train"), ("valid-task", "validation")):
        task(client, key, partition)
        approved(client, key)
    result = client.post(f"{ROOT}/training-export")
    assert result.status_code == 200, result.text
    exported = result.json()
    assert len(exported["train"]) == len(exported["validation"]) == 1
    assert exported["train"][0]["messages"][0]["content"] == "Fix train-task"
    assert client.post(f"{ROOT}/training-export").json() == exported
    with session_factory() as session:
        data = prepare_training_data(session, exported["dataset_version_id"], "ignored replacement")
        assert data.train == exported["train"]
        assert data.validation == exported["validation"]
        assert data.agent_system_id == connected["system_id"]
        assert data.preview().train_count == 1
    catalog = client.get("/api/catalog").json()
    system = next(item for item in catalog["agent_systems"] if item["key"] == "my-agent")
    assert system["runtime"] == "external_harness"


def test_capture_idempotency_secrets_and_review_required(client):
    connect(client)
    task(client)
    payload = capture()
    payload["request"]["authorization"] = "Bearer private-auth-value"
    payload["request"]["messages"][0]["content"] += " sk-abcdefghijklmnop"
    first = client.post(f"{ROOT}/captures", json=payload)
    assert first.status_code == 201
    assert client.post(f"{ROOT}/captures", json=payload).json() == first.json()
    stored = client.get(f"{ROOT}/captures/{first.json()['id']}").json()
    assert "authorization" not in stored["request"]
    assert "sk-abcdefghijklmnop" not in json.dumps(stored)
    assert stored["input_tokens"] is None
    assert client.post(f"{ROOT}/training-export").status_code == 422
    payload["response"]["choices"][0]["message"]["content"] = "Different"
    assert client.post(f"{ROOT}/captures", json=payload).status_code == 422


def test_split_leakage_and_session_ownership(client):
    connect(client)
    task(client)
    task(client, "holdout", "benchmark")
    first = client.post(f"{ROOT}/captures", json=capture())
    assert first.status_code == 201
    duplicate = capture(request_id="other", session_id="other", task_key="holdout")
    # Same full context under another task must not cross the split.
    duplicate["request"] = capture()["request"]
    assert client.post(f"{ROOT}/captures", json=duplicate).status_code == 422
    duplicate["request"] = {"messages": [{"role": "user", "content": "Different input"}]}
    duplicate["session_id"] = "train-task"
    assert client.post(f"{ROOT}/captures", json=duplicate).status_code == 422
    duplicate["session_id"] = "holdout"
    identifier = client.post(f"{ROOT}/captures", json=duplicate).json()["id"]
    assert (
        client.post(
            f"{ROOT}/captures/{identifier}/review", json={"decision": "approved"}
        ).status_code
        == 422
    )
    response = client.post(
        f"{ROOT}/tasks", json={"key": "train-task", "partition": "validation", "prompt": "changed"}
    )
    assert response.status_code == 422


def test_training_rejects_incomplete_and_incremental_responses(client):
    connect(client)
    task(client)
    for index, payload in enumerate(
        [
            capture(
                response={
                    "choices": [
                        {
                            "finish_reason": "length",
                            "message": {"role": "assistant", "content": "cut"},
                        }
                    ]
                }
            ),
            capture(
                protocol="responses",
                request={"previous_response_id": "old", "input": "hi"},
                response={"status": "completed", "output": []},
            ),
        ]
    ):
        payload["request_id"] = str(index)
        identifier = client.post(f"{ROOT}/captures", json=payload).json()["id"]
        assert (
            client.post(
                f"{ROOT}/captures/{identifier}/review", json={"decision": "approved"}
            ).status_code
            == 422
        )


def test_frozen_benchmark_requires_complete_matrix_and_counts_failures(client):
    connect(client)
    task(client, "held", "benchmark")
    suite = client.post(
        f"{ROOT}/suites", json={"name": "Tests", "task_keys": ["held"], "repetitions": 2}
    )
    assert suite.status_code == 201
    payload = {
        "request_id": "run-1",
        "suite_id": suite.json()["id"],
        "label": "Baseline",
        "model": "model-a",
        "harness_revision": "pi@1",
        "configuration_hash": "a" * 64,
        "results": [
            {
                "task_key": "held",
                "repetition": 1,
                "status": "completed",
                "test_exit_code": 0,
                "test_output_hash": "b" * 64,
                "latency_ms": 100,
            }
        ],
    }
    assert client.post(f"{ROOT}/runs", json=payload).status_code == 422
    payload["results"].append(
        {"task_key": "held", "repetition": 2, "status": "timeout", "latency_ms": 1000}
    )
    first = client.post(f"{ROOT}/runs", json=payload)
    assert first.status_code == 201, first.text
    assert client.post(f"{ROOT}/runs", json=payload).json() == first.json()
    run = client.get(ROOT).json()["runs"][0]
    assert run["pass_rate"] == 0.5 and run["failures"] == 1 and run["cost_usd"] is None
    payload["results"][1]["repetition"] = 1
    assert client.post(f"{ROOT}/runs", json=payload).status_code == 422


def test_cross_system_and_task_guardrails(client):
    connect(client)
    task(client)
    identifier = approved(client, "train-task")
    client.post("/api/harnesses", json={"key": "other-agent", "name": "Other", "harness": "codex"})
    assert client.get(f"/api/harnesses/other-agent/captures/{identifier}").status_code == 404
    assert (
        client.post(f"{ROOT}/suites", json={"name": "bad", "task_keys": ["train-task"]}).status_code
        == 422
    )
    assert (
        client.post(
            f"{ROOT}/tasks",
            json={
                "key": "moving",
                "partition": "benchmark",
                "prompt": "x",
                "repository_revision": "main",
                "test_command": ["true"],
            },
        ).status_code
        == 422
    )


def test_native_tools_and_hidden_reasoning():
    request = {
        "messages": [
            {"role": "user", "content": "Read file"},
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "one",
                        "type": "function",
                        "function": {"name": "read", "arguments": "{}"},
                    }
                ],
            },
            {"role": "tool", "tool_call_id": "one", "content": "file contents"},
        ],
        "tools": [
            {"type": "function", "function": {"name": "read", "parameters": {"type": "object"}}}
        ],
    }
    example = training_example(capture(request=request))
    assert example["tools"] == request["tools"]
    assert example["messages"][2]["role"] == "tool"
    broken = copy.deepcopy(request)
    broken["messages"][2]["tool_call_id"] = "unknown"
    with pytest.raises(ValueError, match="matching call"):
        training_example(capture(request=broken))


def test_existing_database_upgrade(session_factory):
    engine = session_factory.kw["bind"]
    create_schema(engine)
    create_schema(engine)
    assert {"harness_tasks", "harness_captures", "harness_runs", "harness_suites"} <= set(
        inspect(engine).get_table_names()
    )


def test_responses_history_reconstructs_tool_context_within_session(client):
    connect(client)
    task(client)
    parent = capture(
        protocol="responses",
        request={"input": "Read x"},
        response={
            "id": "resp-parent",
            "status": "completed",
            "output": [
                {
                    "type": "function_call",
                    "call_id": "call-1",
                    "name": "read",
                    "arguments": '{"path":"x"}',
                }
            ],
        },
    )
    assert client.post(f"{ROOT}/captures", json=parent).status_code == 201
    child = capture(
        request_id="child",
        protocol="responses",
        request={
            "previous_response_id": "resp-parent",
            "input": [
                {
                    "type": "function_call_output",
                    "call_id": "call-1",
                    "output": "file contents",
                }
            ],
        },
        response={
            "id": "resp-child",
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": "Done"}],
                }
            ],
        },
    )
    identifier = client.post(f"{ROOT}/captures", json=child).json()["id"]
    reviewed = client.post(f"{ROOT}/captures/{identifier}/review", json={"decision": "approved"})
    assert reviewed.status_code == 200, reviewed.text
    task(client, "valid-task", "validation")
    approved(client, "valid-task")
    exported = client.post(f"{ROOT}/training-export").json()
    assert [message["role"] for message in exported["train"][0]["messages"]] == [
        "user",
        "assistant",
        "tool",
        "assistant",
    ]
    child["session_id"] = "different-session"
    child["request_id"] = "other-child"
    identifier = client.post(f"{ROOT}/captures", json=child).json()["id"]
    assert (
        client.post(
            f"{ROOT}/captures/{identifier}/review", json={"decision": "approved"}
        ).status_code
        == 422
    )
