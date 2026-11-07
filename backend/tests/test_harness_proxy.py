import json
import stat
import subprocess
import sys

import httpx
import pytest
from fastapi.testclient import TestClient

from autoeval_api.harness_benchmark import run_suite
from autoeval_api.harness_proxy import completed_response, create_recorder, loopback_url
from autoeval_api.services.harness_data import (
    RESPONSE_FIELDS,
    anthropic_messages,
    clean_payload,
    training_example,
)


def sse(events):
    return b"".join(b"data: " + json.dumps(event).encode() + b"\n\n" for event in events)


def test_chat_stream_tool_arguments_and_usage():
    data = sse(
        [
            {
                "choices": [
                    {
                        "index": 0,
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "call1",
                                    "function": {"name": "read", "arguments": '{"pa'},
                                }
                            ]
                        },
                    }
                ]
            },
            {
                "choices": [
                    {
                        "index": 0,
                        "delta": {
                            "tool_calls": [{"index": 0, "function": {"arguments": 'th":"x"}'}}]
                        },
                        "finish_reason": "tool_calls",
                    }
                ]
            },
            {"choices": [], "usage": {"prompt_tokens": 12, "completion_tokens": 8}},
        ]
    )
    result = completed_response(data, "chat", True)
    assert (
        result["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"] == '{"path":"x"}'
    )
    assert result["usage"]["prompt_tokens"] == 12
    with pytest.raises(ValueError, match="complete"):
        completed_response(sse([{"choices": [{"delta": {"content": "partial"}}]}]), "chat", True)


def test_anthropic_and_responses_streams():
    data = sse(
        [
            {"type": "message_start", "message": {"model": "claude", "usage": {"input_tokens": 4}}},
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": {"type": "tool_use", "id": "one", "name": "read", "input": {}},
            },
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "input_json_delta", "partial_json": '{"path":"x"}'},
            },
            {
                "type": "message_delta",
                "delta": {"stop_reason": "tool_use"},
                "usage": {"output_tokens": 7},
            },
            {"type": "message_stop"},
        ]
    )
    response = completed_response(data, "anthropic", True)
    assert response["content"][0]["input"] == {"path": "x"}
    assert response["usage"] == {"input_tokens": 4, "output_tokens": 7}
    example = training_example(
        {
            "protocol": "anthropic",
            "request": {"messages": [{"role": "user", "content": "Read x"}]},
            "response": response,
        }
    )
    assert example["messages"][-1]["tool_calls"][0]["id"] == "one"
    response = {
        "status": "completed",
        "output": [
            {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": "done"}],
            }
        ],
    }
    assert (
        completed_response(
            sse([{"type": "response.completed", "response": response}]), "responses", True
        )
        == response
    )
    assert (
        training_example(
            {"protocol": "responses", "request": {"input": "Fix it"}, "response": response}
        )["messages"][-1]["content"]
        == "done"
    )
    cleaned = clean_payload(
        {
            "content": [
                {"type": "thinking", "thinking": "private"},
                {"type": "text", "text": "public"},
            ]
        },
        RESPONSE_FIELDS,
    )
    assert cleaned["content"] == [{"type": "text", "text": "public"}]


def test_proxy_forwards_stream_unchanged_and_spools_without_headers(tmp_path):
    response_body = sse(
        [
            {
                "model": "actual-model",
                "choices": [{"index": 0, "delta": {"content": "OK"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 1},
            }
        ]
    )

    def upstream(request):
        assert request.url == "http://127.0.0.1:8317/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer very-secret-auth"
        return httpx.Response(
            200, content=response_body, headers={"content-type": "text/event-stream"}
        )

    output = tmp_path / "capture.jsonl"
    app = create_recorder(
        "http://127.0.0.1:8317",
        output,
        "task",
        "pi@1",
        "a" * 64,
        transport=httpx.MockTransport(upstream),
    )
    with TestClient(app) as client:
        response = client.post(
            "/v1/chat/completions",
            json={
                "model": "requested",
                "stream": True,
                "messages": [{"role": "user", "content": "hi"}],
            },
            headers={"authorization": "Bearer very-secret-auth"},
        )
        assert response.status_code == 200 and response.content == response_body
        assert (
            client.post(
                "/v1/chat/completions", json={}, headers={"origin": "https://evil.example"}
            ).status_code
            == 403
        )
        assert client.get("/admin").status_code == 404
    captured = json.loads(output.read_text())
    assert "very-secret-auth" not in output.read_text()
    assert captured["model"] == "actual-model" and captured["input_tokens"] == 5
    assert stat.S_IMODE(output.stat().st_mode) == 0o600


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com",
        "http://127.0.0.1:9/path",
        "http://key@localhost:8",
        "http://localhost:8?url=x",
    ],
)
def test_proxy_rejects_unsafe_upstreams(url):
    with pytest.raises(ValueError):
        loopback_url(url)


def test_benchmark_runner_fresh_checkout_and_failure_accounting(tmp_path):
    repository = tmp_path / "source"
    repository.mkdir()
    subprocess.run(["git", "init", "-q", str(repository)], check=True)
    (repository / "answer").write_text("before")
    subprocess.run(["git", "add", "answer"], cwd=repository, check=True)
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "-qm",
            "fixture",
        ],
        cwd=repository,
        check=True,
    )
    revision = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=repository, text=True
    ).strip()
    suite = {
        "id": "suite",
        "repetitions": 2,
        "tasks": [
            {
                "key": "fix",
                "prompt": "fix it",
                "repository_revision": revision,
                "test_command": [
                    sys.executable,
                    "-c",
                    "from pathlib import Path; assert Path('answer').read_text() == 'after'",
                ],
            }
        ],
    }
    command = [
        sys.executable,
        "-c",
        "from pathlib import Path; import sys; assert sys.stdin.read() == 'fix it'; "
        "assert Path('answer').read_text() == 'before'; "
        "Path('answer').write_text('after')",
        "{model}",
    ]
    result = run_suite(suite, repository, command, "candidate", "test@1", 5, "baseline")
    assert all(
        item["status"] == "completed" and item["test_exit_code"] == 0 for item in result["results"]
    )
    assert (repository / "answer").read_text() == "before"
    result = run_suite(
        suite,
        repository,
        [sys.executable, "-c", "raise SystemExit(2)", "{model}"],
        "candidate",
        "test@1",
        5,
        "failed",
    )
    assert all(item["status"] == "error" for item in result["results"])


def test_tool_errors_are_preserved_in_normalized_training_context():
    result = anthropic_messages(
        [
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "one",
                        "content": "not found",
                        "is_error": True,
                    }
                ],
            }
        ]
    )
    assert result == [{"role": "tool", "tool_call_id": "one", "content": "Tool error: not found"}]
