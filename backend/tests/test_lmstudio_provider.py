import json

import httpx
import pytest

from autoeval_api.config import Settings
from autoeval_api.graph.runner import AgentGraphRunner
from autoeval_api.inference.base import InferenceRequest
from autoeval_api.inference.lmstudio import LMStudioInferenceProvider
from autoeval_api.inference.registry import default_provider_registry


def settings(**overrides) -> Settings:
    values = {
        "AUTOEVAL_ENV": "test",
        "ENABLE_LM_STUDIO": True,
        "LM_STUDIO_BASE_URL": "http://127.0.0.1:1234/v1",
        "LM_STUDIO_MODELS": ["openai/gpt-oss-20b"],
        "LM_STUDIO_API_TOKEN": "local-test-token",
        "_env_file": None,
        **overrides,
    }
    return Settings(**values)


def request(*, response_schema: dict | None = None, state: dict | None = None) -> InferenceRequest:
    return InferenceRequest(
        model_id="lmstudio/openai/gpt-oss-20b",
        system_prompt="Return JSON.",
        task="classify",
        state=state or {"input": {"text": "local incident"}},
        response_schema=response_schema,
    )


@pytest.mark.asyncio
async def test_lmstudio_posts_to_configured_loopback_endpoint_with_structured_output() -> None:
    response_schema = {
        "type": "object",
        "properties": {"classification": {"type": "string"}},
        "required": ["classification"],
        "additionalProperties": False,
    }

    def handler(http_request: httpx.Request) -> httpx.Response:
        assert str(http_request.url) == "http://127.0.0.1:1234/v1/chat/completions"
        assert http_request.headers["authorization"] == "Bearer local-test-token"
        payload = json.loads(http_request.content)
        assert payload["model"] == "openai/gpt-oss-20b"
        assert payload["messages"][0] == {"role": "system", "content": "Return JSON."}
        assert "local incident" in payload["messages"][1]["content"]
        assert payload["max_tokens"] == 4096
        assert payload["temperature"] == 0
        assert payload["seed"] == 0
        assert payload["stream"] is False
        assert payload["response_format"] == {
            "type": "json_schema",
            "json_schema": {
                "name": "autoeval_response",
                "strict": True,
                "schema": response_schema,
            },
        }
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-local-1",
                "model": "openai/gpt-oss-20b",
                "choices": [{"message": {"content": '{"classification":"high"}'}}],
                "usage": {"prompt_tokens": 21, "completion_tokens": 5, "total_tokens": 26},
            },
        )

    provider = LMStudioInferenceProvider(settings(), httpx.MockTransport(handler))
    response = await provider.complete(request(response_schema=response_schema))

    assert response.output == {"classification": "high"}
    assert response.input_tokens == 21
    assert response.output_tokens == 5
    assert response.cost_usd == 0
    assert response.metadata == {
        "request_id": "chatcmpl-local-1",
        "resolved_model": "openai/gpt-oss-20b",
        "usage_reported": True,
    }


@pytest.mark.asyncio
async def test_lmstudio_accepts_fenced_json_without_fabricating_usage() -> None:
    def handler(http_request: httpx.Request) -> httpx.Response:
        payload = json.loads(http_request.content)
        assert "response_format" not in payload
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": '```json\n{"answer":"ok"}\n```'}}]},
        )

    provider = LMStudioInferenceProvider(settings(), httpx.MockTransport(handler))
    response = await provider.complete(request())

    assert response.output == {"answer": "ok"}
    assert response.input_tokens == 0
    assert response.output_tokens == 0
    assert response.cost_usd == 0
    assert response.metadata["usage_reported"] is False
    assert (
        AgentGraphRunner._span_output("import-test", {}, response)["_inference"]["usage_reported"]
        is False
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "content,finish_reason",
    [
        ('{"answer":"ok"}', "length"),
        ('{"answer":"ok"}', "tool_calls"),
        ('{"answer":"ok"} trailing garbage', "stop"),
        ('{"answer":"ok"} {"another":true}', "stop"),
        ('Here is the output: {"answer":"ok"}', "stop"),
        ('{"answer":', "stop"),
        ("[]", "stop"),
    ],
)
async def test_lmstudio_rejects_incomplete_or_nonobject_output(content, finish_reason):
    transport = httpx.MockTransport(
        lambda _: httpx.Response(
            200,
            json={"choices": [{"message": {"content": content}, "finish_reason": finish_reason}]},
        )
    )
    provider = LMStudioInferenceProvider(settings(), transport)
    with pytest.raises(ValueError):
        await provider.complete(request())


@pytest.mark.asyncio
async def test_lmstudio_error_does_not_expose_response_or_api_token() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401,
            json={"error": {"message": "token local-test-token was rejected"}},
        )

    provider = LMStudioInferenceProvider(settings(), httpx.MockTransport(handler))
    with pytest.raises(RuntimeError, match=r"LM Studio request failed \(401\)") as raised:
        await provider.complete(request())

    assert "local-test-token" not in str(raised.value)
    assert "rejected" not in str(raised.value)


@pytest.mark.asyncio
async def test_lmstudio_does_not_follow_redirects() -> None:
    requests = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        return httpx.Response(307, headers={"Location": "http://example.com/v1/chat/completions"})

    provider = LMStudioInferenceProvider(settings(), httpx.MockTransport(handler))
    with pytest.raises(RuntimeError, match=r"LM Studio request failed \(307\)"):
        await provider.complete(request())

    assert requests == 1


@pytest.mark.asyncio
async def test_lmstudio_enforces_request_and_response_size_limits() -> None:
    def oversized_response(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * 10_001)

    response_limited = LMStudioInferenceProvider(
        settings(lm_studio_max_response_bytes=10_000),
        httpx.MockTransport(oversized_response),
    )
    with pytest.raises(RuntimeError, match="response exceeded"):
        await response_limited.complete(request())

    request_limited = LMStudioInferenceProvider(
        settings(lm_studio_max_request_bytes=10_000),
        httpx.MockTransport(lambda _: pytest.fail("oversized request must stay local")),
    )
    with pytest.raises(RuntimeError, match="request exceeded"):
        await request_limited.complete(request(state={"input": {"text": "x" * 11_000}}))


@pytest.mark.asyncio
async def test_lmstudio_rejects_disabled_unknown_and_multimodal_requests() -> None:
    disabled = LMStudioInferenceProvider(settings(ENABLE_LM_STUDIO=False))
    with pytest.raises(RuntimeError, match="disabled"):
        await disabled.complete(request())

    enabled = LMStudioInferenceProvider(settings())
    unknown = request()
    unknown = InferenceRequest(
        model_id="lmstudio/not-configured",
        system_prompt=unknown.system_prompt,
        task=unknown.task,
        state=unknown.state,
    )
    with pytest.raises(ValueError, match="Unsupported LM Studio model"):
        await enabled.complete(unknown)

    multimodal = request()
    multimodal = InferenceRequest(
        model_id=multimodal.model_id,
        system_prompt=multimodal.system_prompt,
        task=multimodal.task,
        state=multimodal.state,
        modalities=[{"type": "image_url", "image_url": {"url": "https://example.test/a.png"}}],
    )
    with pytest.raises(ValueError, match="text input only"):
        await enabled.complete(multimodal)


def test_lmstudio_catalog_uses_configured_normalized_ids_without_discovery() -> None:
    configured = settings(LM_STUDIO_MODELS=["openai/gpt-oss-20b", "custom-local-model"])
    registry = default_provider_registry(configured)
    local_models = [model for model in registry.models() if model.provider == "lmstudio"]

    assert [model.id for model in local_models] == [
        "lmstudio/openai/gpt-oss-20b",
        "lmstudio/custom-local-model",
    ]
    assert all(model.available for model in local_models)
    assert all(model.supports == ("text",) for model in local_models)
