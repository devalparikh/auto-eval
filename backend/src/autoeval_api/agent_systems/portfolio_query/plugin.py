from autoeval_api.agent_systems.portfolio_query.definition import PORTFOLIO_QUERY_INPUT_TEMPLATE
from autoeval_api.agent_systems.registry import AgentSystemPlugin, AgentSystemSpec

PLUGIN = AgentSystemPlugin(
    package="autoeval_api.agent_systems.portfolio_query",
    spec=AgentSystemSpec(
        key="portfolio-query",
        default_model_ids=("mock/portfolio-analyst", "mock/portfolio-fast"),
        input_template=PORTFOLIO_QUERY_INPUT_TEMPLATE,
        dataset_editor="json",
        primary_metric="safety_weighted_accuracy",
    ),
    trace_policy_module="autoeval_api.agent_systems.portfolio_query.trace_policy",
)
