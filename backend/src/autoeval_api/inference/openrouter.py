import json
from typing import Any

import httpx

from autoeval_api.config import Settings
from autoeval_api.inference.base import (
    InferenceRequest,
    InferenceResponse,
    ModelDescriptor,
)


class OpenRouterInferenceProvider:
    provider_id = "openrouter"
    api_url = "https://openrouter.ai/api/v1/chat/completions"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def models(self) -> list[ModelDescriptor]:
        available = bool(self.settings.openrouter_api_key)
        return [
            ModelDescriptor(
                id="openrouter/openai/gpt-5-mini",
                provider=self.provider_id,
                label="OpenAI GPT-5 mini",
                supports=("text", "image"),
                available=available,
            ),
            ModelDescriptor(
                id="openrouter/anthropic/claude-sonnet-4.5",
                provider=self.provider_id,
                label="Claude Sonnet 4.5",
                supports=("text", "image"),
                available=available,
            ),
            ModelDescriptor(
                id="openrouter/google/gemini-2.5-flash",
                provider=self.provider_id,
                label="Gemini 2.5 Flash",
                supports=("text", "image", "audio"),
                available=available,
            ),
        ]

    async def complete(self, request: InferenceRequest) -> InferenceResponse:
        if not self.settings.openrouter_api_key:
            raise RuntimeError("OPENROUTER_API_KEY is not configured")

        model_name = request.model_id.removeprefix("openrouter/")
        user_content: list[dict[str, Any]] = [
            {
                "type": "text",
                "text": (
                    f"Task: {request.task}\n"
                    "Return one JSON object only.\n"
                    f"State: {json.dumps(request.state, sort_keys=True)}"
                ),
            }
        ]
        user_content.extend(request.modalities)
        payload = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": request.system_prompt},
                {"role": "user", "content": user_content},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0,
        }
        headers = {
            "Authorization": f"Bearer {self.settings.openrouter_api_key}",
            "HTTP-Referer": self.settings.openrouter_app_url,
            "X-Title": self.settings.openrouter_app_name,
        }

        timeout = httpx.Timeout(90, connect=10)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            response = await client.post(self.api_url, headers=headers, json=payload)
            response.raise_for_status()
        body = response.json()
        raw_text = body["choices"][0]["message"]["content"]
        output = self._parse_object(raw_text)
        usage = body.get("usage", {})
        return InferenceResponse(
            output=output,
            raw_text=raw_text,
            input_tokens=int(usage.get("prompt_tokens", 0)),
            output_tokens=int(usage.get("completion_tokens", 0)),
            cost_usd=float(usage.get("cost", 0) or 0),
            metadata={"request_id": body.get("id")},
        )

    @staticmethod
    def _parse_object(raw_text: str) -> dict[str, Any]:
        parsed = json.loads(raw_text)
        if not isinstance(parsed, dict):
            raise ValueError("Inference output must be a JSON object")
        return parsed
