from autoeval_api.agent_systems.portfolio_analyst.definition import PORTFOLIO_INPUT_TEMPLATE
from autoeval_api.agent_systems.registry import AgentSystemPlugin, AgentSystemSpec

PLUGIN = AgentSystemPlugin(
    package="autoeval_api.agent_systems.portfolio_analyst",
    spec=AgentSystemSpec(
        key="portfolio-analyst",
        default_model_ids=("mock/portfolio-analyst", "mock/portfolio-fast"),
        input_template=PORTFOLIO_INPUT_TEMPLATE,
        dataset_editor="json",
    ),
    trace_policy_module="autoeval_api.agent_systems.portfolio_analyst.trace_policy",
)
