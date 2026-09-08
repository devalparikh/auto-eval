import json
from typing import Any

import httpx

from autoeval_api.config import Settings
from autoeval_api.inference.base import InferenceRequest, InferenceResponse, ModelDescriptor


# TODO: is it good practice to have child class be implicit and not explicitly
# extending a base class?
class LMStudioInferenceProvider:
    """Opt-in adapter for LM Studio's loopback OpenAI-compatible server."""

    provider_id = "lmstudio"

    def __init__(
        self,
        settings: Settings,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.settings = settings
        self.transport = transport

    def models(self) -> list[ModelDescriptor]:
        return [
            ModelDescriptor(
                id=f"{self.provider_id}/{model_id}",
                provider=self.provider_id,
                label=f"LM Studio: {model_id}",
                supports=("text",),
                available=self.settings.enable_lm_studio,
                notice="Local inference through the configured LM Studio server; API cost is $0.",
            )
            for model_id in self.settings.lm_studio_models
        ]

    async def complete(self, request: InferenceRequest) -> InferenceResponse:
        if not self.settings.enable_lm_studio:
            raise RuntimeError("LM Studio inference is disabled")
        model_id = self._configured_model_id(request.model_id)
        if request.modalities:
            raise ValueError("LM Studio configured models accept text input only")

        payload: dict[str, Any] = {
            "model": model_id,
            "messages": [
                {"role": "system", "content": request.system_prompt},
                {
                    "role": "user",
                    "content": (
                        f"Task: {request.task}\n"
                        "Return one JSON object only.\n"
                        f"State: {json.dumps(request.state, sort_keys=True)}"
                    ),
                },
            ],
            "max_tokens": self.settings.lm_studio_max_output_tokens,
            "temperature": 0,
            "seed": 0,
            "stream": False,
        }
        if request.response_schema is not None:
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "autoeval_response",
                    "strict": True,
                    "schema": request.response_schema,
                },
            }

        # TODO: do a safety check is this ok to do?
        request_body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
        if len(request_body) > self.settings.lm_studio_max_request_bytes:
            raise RuntimeError("LM Studio request exceeded the configured size limit")

        headers = {"Content-Type": "application/json"}
        if self.settings.lm_studio_api_token is not None:
            token = self.settings.lm_studio_api_token.get_secret_value()
            if token:
                headers["Authorization"] = f"Bearer {token}"

        timeout = httpx.Timeout(
            self.settings.lm_studio_timeout_seconds,
            connect=min(10, self.settings.lm_studio_timeout_seconds),
        )
        try:
            async with (
                httpx.AsyncClient(
                    timeout=timeout,
                    follow_redirects=False,
                    trust_env=False,
                    transport=self.transport,
                ) as client,
                client.stream(
                    "POST",
                    f"{self.settings.lm_studio_base_url}/chat/completions",
                    headers=headers,
                    content=request_body,
                ) as response,
            ):
                response_body = await self._read_bounded_response(response)
        except httpx.TimeoutException:
            raise RuntimeError("LM Studio request timed out") from None
        except httpx.RequestError:
            raise RuntimeError(
                "LM Studio request failed; confirm that the local server is running"
            ) from None

        if not response.is_success:
            raise RuntimeError(f"LM Studio request failed ({response.status_code})")
        body = self._response_object(response_body)
        raw_text = self._response_text(body)
        output = self._parse_object(raw_text)
        usage = body.get("usage")
        usage_object = usage if isinstance(usage, dict) else {}
        input_tokens = self._nonnegative_int(usage_object.get("prompt_tokens"))
        output_tokens = self._nonnegative_int(usage_object.get("completion_tokens"))
        usage_reported = (
            type(usage_object.get("prompt_tokens")) is int
            and type(usage_object.get("completion_tokens")) is int
            and usage_object["prompt_tokens"] >= 0
            and usage_object["completion_tokens"] >= 0
        )
        return InferenceResponse(
            output=output,
            raw_text=raw_text,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=0,
            metadata={
                "request_id": body.get("id"),
                "resolved_model": body.get("model"),
                "usage_reported": usage_reported,
            },
        )

    def _configured_model_id(self, normalized_model_id: str) -> str:
        prefix = f"{self.provider_id}/"
        if not normalized_model_id.startswith(prefix):
            raise ValueError(f"Unsupported LM Studio model: {normalized_model_id}")
        model_id = normalized_model_id.removeprefix(prefix)
        if model_id not in self.settings.lm_studio_models:
            raise ValueError(f"Unsupported LM Studio model: {model_id}")
        return model_id

    async def _read_bounded_response(self, response: httpx.Response) -> bytes:
        content = bytearray()
        async for chunk in response.aiter_bytes():
            content.extend(chunk)
            if len(content) > self.settings.lm_studio_max_response_bytes:
                raise RuntimeError("LM Studio response exceeded the configured size limit")
        return bytes(content)

    @staticmethod
    def _response_object(response_body: bytes) -> dict[str, Any]:
        try:
            parsed = json.loads(response_body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ValueError("LM Studio response must be valid JSON") from None
        if not isinstance(parsed, dict):
            raise ValueError("LM Studio response must be a JSON object")
        return parsed

    @staticmethod
    def _response_text(body: dict[str, Any]) -> str:
        choices = body.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise ValueError("LM Studio response is missing a completion choice")
        finish_reason = choices[0].get("finish_reason")
        if finish_reason not in {None, "stop"}:
            raise ValueError("LM Studio did not finish a complete text response")
        message = choices[0].get("message")
        if not isinstance(message, dict) or not isinstance(message.get("content"), str):
            raise ValueError("LM Studio response content must be text")
        return message["content"]

    @staticmethod
    def _nonnegative_int(value: object) -> int:
        return value if type(value) is int and value >= 0 else 0

    @staticmethod
    def _parse_object(raw_text: str) -> dict[str, Any]:
        text = raw_text.strip()
        if text.startswith("```"):
            lines = text.splitlines()
            if lines and lines[-1].strip() == "```":
                text = "\n".join(lines[1:-1]).strip()
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            raise ValueError("LM Studio output must contain one complete JSON object") from None
        if not isinstance(parsed, dict):
            raise ValueError("LM Studio output must be a JSON object")
        return parsed
