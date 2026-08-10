import re
from typing import Any

from autoeval_api.graph.registry import NodeHandlerRegistry
from autoeval_api.inference.base import InferenceResponse


def register_handlers(registry: NodeHandlerRegistry) -> None:
    registry.register_deterministic("normalize_incident", normalize_incident)
    registry.register_deterministic("apply_triage_policy", apply_triage_policy)
    registry.register_llm_output("classify_incident", merge_inference_output)
    registry.register_llm_output("draft_response", merge_inference_output)


def normalize_incident(state: dict[str, Any]) -> dict[str, Any]:
    request_input = state.get("input", {})
    text = re.sub(r"\s+", " ", str(request_input.get("text", ""))).strip()
    modalities = request_input.get("modalities", [])
    if not isinstance(modalities, list):
        modalities = []
    return {
        "normalized": {
            "text": text,
            "service": str(request_input.get("service", "unknown")),
            "customer_tier": str(request_input.get("customer_tier", "standard")),
            "modalities": modalities,
        }
    }


def apply_triage_policy(state: dict[str, Any]) -> dict[str, Any]:
    classification = state.get("classification", {})
    severity = classification.get("severity", "medium")
    route = classification.get("route", "support")
    actions = {
        "critical": "Page the on-call lead and open an incident channel now.",
        "high": "Notify the owning on-call team and confirm impact within 15 minutes.",
        "medium": "Assign the report to the owning queue for same-day review.",
        "low": "Add the report to the standard support queue.",
    }
    return {
        "policy": {
            "requires_human": severity in {"critical", "high"},
            "route": route,
            "next_action": actions.get(severity, actions["medium"]),
        }
    }


def merge_inference_output(_state: dict[str, Any], response: InferenceResponse) -> dict[str, Any]:
    return response.output
