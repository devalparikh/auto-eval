from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class AgentSystemSpec:
    key: str
    default_model_ids: tuple[str, ...]
    input_template: dict[str, Any]
    dataset_editor: str
    primary_metric: str = "accuracy"


def system_specs() -> dict[str, AgentSystemSpec]:
    from autoeval_api.agent_systems.portfolio_analyst.definition import (
        PORTFOLIO_INPUT_TEMPLATE,
    )

    return {
        "incident-triage": AgentSystemSpec(
            key="incident-triage",
            default_model_ids=("mock/incident-specialist", "mock/incident-fast"),
            input_template={
                "text": "The checkout service is returning 5xx errors for enterprise customers.",
                "service": "checkout",
                "customer_tier": "standard",
            },
            dataset_editor="incident-triage",
        ),
        "portfolio-analyst": AgentSystemSpec(
            key="portfolio-analyst",
            default_model_ids=("mock/portfolio-analyst", "mock/portfolio-fast"),
            input_template=PORTFOLIO_INPUT_TEMPLATE,
            dataset_editor="json",
        ),
    }


def system_spec(key: str) -> AgentSystemSpec:
    return system_specs().get(
        key,
        AgentSystemSpec(
            key=key,
            default_model_ids=(),
            input_template={},
            dataset_editor="json",
        ),
    )
