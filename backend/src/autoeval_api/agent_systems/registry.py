from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from importlib import import_module
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    # Deferred: importing `graph.definition` at module load time would import the
    # `graph` package, whose `runner` -> `trace_policy` chain imports this module
    # back (see `system_plugins()`), so a top-level import here would cycle.
    from autoeval_api.graph.definition import AgentGraphDefinition


@dataclass(frozen=True)
class AgentSystemSpec:
    key: str
    default_model_ids: tuple[str, ...]
    input_template: dict[str, Any]
    dataset_editor: str
    primary_metric: str = "accuracy"
    product_key: str | None = None
    flow_key: str = "run"
    flow_name: str = "Run"


@dataclass(frozen=True)
class AgentSystemPlugin:
    """Declarative registration boundary for one independently runnable graph."""

    package: str
    spec: AgentSystemSpec
    trace_policy_module: str | None = None
    legacy_locked_input_exemptions_module: str | None = None

    def register_handlers(self, registry: Any) -> None:
        module = import_module(f"{self.package}.handlers")
        module.register_handlers(registry.scoped(self.spec.key))

    def scoring_entries(self) -> list[tuple[str, Any]]:
        module = import_module(f"{self.package}.scoring")
        return list(module.scoring_entries())

    def seed_data(self, session: Any) -> Any:
        module = import_module(f"{self.package}.seed")
        return module.ensure_seed_data(session)

    def demo_hook(self) -> Callable[..., Awaitable[None]]:
        module = import_module(f"{self.package}.seed")
        return module.ensure_demo_runs

    def project_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.trace_policy_module is None:
            from copy import deepcopy

            return deepcopy(payload)
        module = import_module(self.trace_policy_module)
        return module.project_payload(payload)

    def project_inference_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.trace_policy_module is None:
            from copy import deepcopy

            return deepcopy(payload)
        module = import_module(self.trace_policy_module)
        projector = getattr(module, "project_inference_payload", module.project_payload)
        return projector(payload)

    def legacy_locked_input_exemptions(
        self, definition: AgentGraphDefinition, item_input: dict[str, Any]
    ) -> set[str]:
        """Node ids that may skip the locked-runtime-input requirement.

        Compatibility escape hatch for finalized dataset versions that predate
        runtime-input snapshots. Most systems have nothing to exempt.
        """
        if self.legacy_locked_input_exemptions_module is None:
            return set()
        module = import_module(self.legacy_locked_input_exemptions_module)
        return module.legacy_locked_input_exemptions(definition, item_input)


def builtin_system_plugins() -> tuple[AgentSystemPlugin, ...]:
    """The only composition root that changes when a built-in system is added."""
    from autoeval_api.agent_systems.incident_triage.plugin import PLUGIN as incident_triage
    from autoeval_api.agent_systems.portfolio_analyst.plugin import PLUGIN as portfolio_analyst
    from autoeval_api.agent_systems.portfolio_query.plugin import PLUGIN as portfolio_query

    return incident_triage, portfolio_analyst, portfolio_query


def system_plugins() -> dict[str, AgentSystemPlugin]:
    return {plugin.spec.key: plugin for plugin in builtin_system_plugins()}


def system_specs() -> dict[str, AgentSystemSpec]:
    return {key: plugin.spec for key, plugin in system_plugins().items()}


def system_spec(key: str) -> AgentSystemSpec:
    plugin = system_plugins().get(key)
    if plugin is not None:
        return plugin.spec
    return AgentSystemSpec(
        key=key,
        default_model_ids=(),
        input_template={},
        dataset_editor="json",
    )
