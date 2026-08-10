import json
from typing import Any

import httpx

from autoeval_api.config import Settings
from autoeval_api.inference.base import InferenceRequest, InferenceResponse, ModelDescriptor
from autoeval_api.inference.model_catalog import OpenRouterModelConfig, openrouter_model


class OpenRouterInferenceProvider:
    provider_id = "openrouter"
    api_url = "https://openrouter.ai/api/v1/chat/completions"
    finance_agent_system_keys = frozenset({"portfolio-analyst", "portfolio-query"})

    def __init__(
        self,
        settings: Settings,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.settings = settings
        self.transport = transport

    def models(self) -> list[ModelDescriptor]:
        from autoeval_api.inference.model_catalog import OPENROUTER_MODELS

        available = bool(self.settings.openrouter_api_key)
        return [model.descriptor(available) for model in OPENROUTER_MODELS]

    async def complete(self, request: InferenceRequest) -> InferenceResponse:
        if not self.settings.openrouter_api_key:
            raise RuntimeError("OPENROUTER_API_KEY is not configured")

        model = openrouter_model(request.model_id)
        self._require_safe_input(model, request)
        payload = self._request_payload(model, request)
        headers = {
            "Authorization": f"Bearer {self.settings.openrouter_api_key}",
            "HTTP-Referer": self.settings.openrouter_app_url,
            "X-OpenRouter-Title": self.settings.openrouter_app_name,
        }
        if request.agent_system_key in self.finance_agent_system_keys:
            headers["X-OpenRouter-Cache"] = "false"

        timeout = httpx.Timeout(90, connect=10)
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=False,
            transport=self.transport,
        ) as client:
            response = await client.post(self.api_url, headers=headers, json=payload)
            self._raise_for_status(response)
        body = response.json()
        raw_text = body["choices"][0]["message"]["content"]
        if not isinstance(raw_text, str):
            raise ValueError("OpenRouter response content must be text")
        output = self._parse_object(raw_text)
        usage = body.get("usage", {})
        return InferenceResponse(
            output=output,
            raw_text=raw_text,
            input_tokens=int(usage.get("prompt_tokens", 0)),
            output_tokens=int(usage.get("completion_tokens", 0)),
            cost_usd=float(usage.get("cost", 0) or 0),
            metadata={
                "request_id": body.get("id"),
                "resolved_model": body.get("model"),
            },
        )

    def _request_payload(
        self,
        model: OpenRouterModelConfig,
        request: InferenceRequest,
    ) -> dict[str, Any]:
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
        payload: dict[str, Any] = {
            "model": model.slug,
            "messages": [
                {"role": "system", "content": request.system_prompt},
                {"role": "user", "content": user_content},
            ],
            "provider": {"data_collection": model.data_collection},
        }
        is_finance_request = request.agent_system_key in self.finance_agent_system_keys
        requires_zdr = is_finance_request and not self._is_synthetic_finance_state(request.state)
        if requires_zdr:
            payload["provider"]["zdr"] = True
        output_token_parameter = (
            model.zdr_output_token_parameter
            if requires_zdr and model.zdr_output_token_parameter is not None
            else "max_tokens"
        )
        payload[output_token_parameter] = self.settings.openrouter_max_output_tokens
        if "response_format" in model.supported_parameters:
            if (
                request.response_schema is not None
                and "structured_outputs" in model.supported_parameters
            ):
                payload["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "autoeval_response",
                        "strict": True,
                        "schema": request.response_schema,
                    },
                }
            else:
                payload["response_format"] = {"type": "json_object"}
            payload["provider"]["require_parameters"] = True
        if "temperature" in model.supported_parameters:
            payload["temperature"] = 0
        if "seed" in model.supported_parameters:
            payload["seed"] = 0
        return payload

    @staticmethod
    def _is_synthetic_finance_state(state: dict[str, Any]) -> bool:
        request_input = state.get("input")
        if isinstance(request_input, dict) and request_input.get("is_synthetic") is True:
            return True
        normalized = state.get("normalized")
        if isinstance(normalized, dict) and normalized.get("is_synthetic") is True:
            return True
        model_context = state.get("portfolio_model_context")
        snapshot = model_context.get("snapshot") if isinstance(model_context, dict) else None
        return isinstance(snapshot, dict) and snapshot.get("is_synthetic") is True

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        if not response.is_error:
            return

        message: object = response.reason_phrase
        try:
            body = response.json()
        except (json.JSONDecodeError, UnicodeDecodeError):
            body = None
        if isinstance(body, dict):
            error = body.get("error")
            if isinstance(error, dict):
                message = error.get("message") or message
            elif isinstance(error, str):
                message = error

        safe_message = " ".join(str(message).split())[:1000]
        raise RuntimeError(f"OpenRouter request failed ({response.status_code}): {safe_message}")

    @staticmethod
    def _require_safe_input(model: OpenRouterModelConfig, request: InferenceRequest) -> None:
        if request.agent_system_key in model.blocked_agent_system_keys:
            raise RuntimeError(
                f"{model.label} is disabled for {request.agent_system_key} because its "
                "provider data policy is not appropriate for portfolio data"
            )
        if not model.requires_synthetic_input:
            return
        state = request.state
        request_input = state.get("input", {}) if isinstance(state.get("input"), dict) else {}
        snapshot = (
            request_input.get("snapshot", {})
            if isinstance(request_input.get("snapshot"), dict)
            else {}
        )
        if not (request_input.get("is_synthetic") is True or snapshot.get("is_synthetic") is True):
            raise RuntimeError(
                f"{model.label} requires input.is_synthetic=true because its free endpoint "
                "must not receive confidential or personal data"
            )

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
            start = text.find("{")
            if start < 0:
                raise ValueError("Inference output must contain a JSON object") from None
            try:
                parsed, _ = json.JSONDecoder().raw_decode(text[start:])
            except json.JSONDecodeError as error:
                raise ValueError("Inference output must contain a valid JSON object") from error
        if not isinstance(parsed, dict):
            raise ValueError("Inference output must be a JSON object")
        return parsed
