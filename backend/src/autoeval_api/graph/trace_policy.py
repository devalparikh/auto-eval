from copy import deepcopy
from typing import Any

from autoeval_api.agent_systems.registry import system_plugins


def project_trace_payload(system_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    plugin = system_plugins().get(system_key)
    return plugin.project_payload(payload) if plugin is not None else deepcopy(payload)


def project_inference_payload(system_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Apply the stricter provider-bound projection before state leaves the process."""
    plugin = system_plugins().get(system_key)
    return plugin.project_inference_payload(payload) if plugin is not None else deepcopy(payload)
