import hashlib
import json
import re
from typing import Any

from autoeval_api.inference.base import (
    InferenceRequest,
    InferenceResponse,
    ModelDescriptor,
)


class MockInferenceProvider:
    provider_id = "mock"

    def models(self) -> list[ModelDescriptor]:
        return [
            ModelDescriptor(
                id="mock/incident-specialist",
                provider=self.provider_id,
                label="Mock incident specialist",
                supports=("text", "image", "audio"),
            ),
            ModelDescriptor(
                id="mock/incident-fast",
                provider=self.provider_id,
                label="Mock incident fast",
                supports=("text",),
            ),
        ]

    async def complete(self, request: InferenceRequest) -> InferenceResponse:
        if request.task == "classify_incident":
            output = self._classify(request)
        elif request.task == "draft_response":
            output = self._draft(request)
        else:
            output = {"result": "Mock provider completed the requested task."}

        raw_text = json.dumps(output, sort_keys=True)
        input_text = json.dumps(request.state, sort_keys=True)
        input_tokens = max(1, len(input_text) // 4)
        output_tokens = max(1, len(raw_text) // 4)
        multiplier = 1.0 if request.model_id.endswith("specialist") else 0.35
        return InferenceResponse(
            output=output,
            raw_text=raw_text,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=round((input_tokens * 0.0000003 + output_tokens * 0.0000006) * multiplier, 8),
            metadata={"deterministic": True},
        )

    def _classify(self, request: InferenceRequest) -> dict[str, Any]:
        incident = request.state.get("normalized", request.state.get("input", {}))
        text = str(incident.get("text", "")).lower()

        security_words = ("breach", "credential", "token leaked", "ransomware", "unauthorized")
        availability_words = ("down", "outage", "unavailable", "5xx", "cannot access")
        data_words = ("data loss", "corrupt", "deleted", "missing records")
        payment_words = ("payment", "checkout", "charge", "billing")

        if any(word in text for word in security_words):
            severity, route = "critical", "security"
        elif any(word in text for word in data_words):
            severity, route = "critical", "data"
        elif any(word in text for word in availability_words):
            severity, route = "high", "platform"
        elif any(word in text for word in payment_words):
            severity, route = "high", "payments"
        else:
            severity, route = "medium", "support"

        if request.model_id.endswith("fast") and self._should_degrade(text):
            severity = "medium" if severity == "high" else severity

        confidence = 0.96 if severity == "critical" else 0.89
        return {
            "classification": {
                "severity": severity,
                "route": route,
                "confidence": confidence,
                "evidence": self._evidence(text),
            }
        }

    def _draft(self, request: InferenceRequest) -> dict[str, Any]:
        classification = request.state.get("classification", {})
        policy = request.state.get("policy", {})
        severity = classification.get("severity", "medium")
        route = classification.get("route", "support")
        response = (
            f"Incident classified as {severity}. Route to {route}. "
            f"{policy.get('next_action', 'Review the report and confirm impact.')}"
        )
        return {
            "output": {
                "severity": severity,
                "route": route,
                "requires_human": policy.get("requires_human", True),
                "response": response,
            }
        }

    @staticmethod
    def _should_degrade(text: str) -> bool:
        digest = hashlib.sha256(text.encode()).digest()
        return digest[0] % 4 == 0

    @staticmethod
    def _evidence(text: str) -> list[str]:
        words = re.findall(r"[a-z0-9]+", text)
        return words[:6]
