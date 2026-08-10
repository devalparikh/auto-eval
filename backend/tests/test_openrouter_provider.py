import json

import httpx
import pytest

from autoeval_api.config import Settings
from autoeval_api.inference.base import InferenceRequest
from autoeval_api.inference.openrouter import OpenRouterInferenceProvider


def settings() -> Settings:
    return Settings(
        AUTOEVAL_ENV="test",
        OPENROUTER_API_KEY="test-key",
        OPENROUTER_APP_URL="http://localhost:3000",
        OPENROUTER_APP_NAME="AutoEval Test",
    )


def request(model_id: str, state: dict | None = None) -> InferenceRequest:
    return InferenceRequest(
        model_id=model_id,
        system_prompt="Return JSON.",
        task="classify",
        state=state or {"input": {"is_synthetic": True, "text": "synthetic incident"}},
    )


@pytest.mark.asyncio
async def test_openrouter_uses_current_endpoint_headers_and_luna_capabilities():
    def handler(http_request: httpx.Request) -> httpx.Response:
        assert str(http_request.url) == "https://openrouter.ai/api/v1/chat/completions"
        assert http_request.headers["authorization"] == "Bearer test-key"
        assert http_request.headers["http-referer"] == "http://localhost:3000"
        assert http_request.headers["x-openrouter-title"] == "AutoEval Test"

        payload = json.loads(http_request.content)
        assert payload["model"] == "openai/gpt-5.6-luna"
        assert payload["response_format"] == {"type": "json_object"}
        assert payload["seed"] == 0
        assert payload["max_tokens"] == 4096
        assert payload["provider"] == {
            "data_collection": "deny",
            "require_parameters": True,
        }
        assert "temperature" not in payload
        return httpx.Response(
            200,
            json={
                "id": "generation-1",
                "model": "openai/gpt-5.6-luna-20260806",
                "choices": [{"message": {"content": '{"classification":"ok"}'}}],
                "usage": {"prompt_tokens": 12, "completion_tokens": 4, "cost": 0.0012},
            },
        )

    provider = OpenRouterInferenceProvider(settings(), httpx.MockTransport(handler))
    response = await provider.complete(request("openrouter/openai/gpt-5.6-luna"))

    assert response.output == {"classification": "ok"}
    assert response.input_tokens == 12
    assert response.output_tokens == 4
    assert response.cost_usd == pytest.approx(0.0012)
    assert response.metadata == {
        "request_id": "generation-1",
        "resolved_model": "openai/gpt-5.6-luna-20260806",
    }


@pytest.mark.asyncio
async def test_nemotron_omits_unsupported_json_mode_and_accepts_fenced_json():
    def handler(http_request: httpx.Request) -> httpx.Response:
        payload = json.loads(http_request.content)
        assert payload["model"] == "nvidia/nemotron-3-ultra-550b-a55b:free"
        assert payload["provider"] == {"data_collection": "allow"}
        assert payload["temperature"] == 0
        assert payload["seed"] == 0
        assert "response_format" not in payload
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": '```json\n{"answer": "ok"}\n```'}}],
                "usage": {},
            },
        )

    provider = OpenRouterInferenceProvider(settings(), httpx.MockTransport(handler))
    response = await provider.complete(request("openrouter/nvidia/nemotron-3-ultra-550b-a55b:free"))

    assert response.output == {"answer": "ok"}


@pytest.mark.asyncio
async def test_nemotron_rejects_non_synthetic_input_before_network_access():
    def unexpected_request(_: httpx.Request) -> httpx.Response:
        raise AssertionError("unsafe input must not leave the process")

    provider = OpenRouterInferenceProvider(settings(), httpx.MockTransport(unexpected_request))

    with pytest.raises(RuntimeError, match="requires input.is_synthetic=true"):
        await provider.complete(
            request(
                "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
                {"input": {"text": "possibly confidential"}},
            )
        )


@pytest.mark.asyncio
async def test_nemotron_is_never_sent_portfolio_workflow_data():
    def unexpected_request(_: httpx.Request) -> httpx.Response:
        raise AssertionError("portfolio data must not leave the process")

    provider = OpenRouterInferenceProvider(settings(), httpx.MockTransport(unexpected_request))
    portfolio_request = request("openrouter/nvidia/nemotron-3-ultra-550b-a55b:free")
    portfolio_request = InferenceRequest(
        model_id=portfolio_request.model_id,
        system_prompt=portfolio_request.system_prompt,
        task=portfolio_request.task,
        state=portfolio_request.state,
        agent_system_key="portfolio-query",
    )

    with pytest.raises(RuntimeError, match="disabled for portfolio-query"):
        await provider.complete(portfolio_request)


@pytest.mark.asyncio
async def test_openrouter_rejects_non_object_output():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "[1, 2, 3]"}}]},
        )

    provider = OpenRouterInferenceProvider(settings(), httpx.MockTransport(handler))

    with pytest.raises(ValueError, match="JSON object"):
        await provider.complete(request("openrouter/deepseek/deepseek-v4-flash"))


def test_openrouter_catalog_exposes_requested_models():
    model_ids = {model.id for model in OpenRouterInferenceProvider(settings()).models()}

    assert {
        "openrouter/openai/gpt-5.6-luna",
        "openrouter/deepseek/deepseek-v4-flash",
        "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
    } <= model_ids
