from autoeval_api.agent_systems.registry import AgentSystemPlugin, AgentSystemSpec

PLUGIN = AgentSystemPlugin(
    package="autoeval_api.agent_systems.incident_triage",
    spec=AgentSystemSpec(
        key="incident-triage",
        default_model_ids=("mock/incident-specialist", "mock/incident-fast"),
        input_template={
            "is_synthetic": True,
            "text": "The checkout service is returning 5xx errors for enterprise customers.",
            "service": "checkout",
            "customer_tier": "standard",
        },
        dataset_editor="incident-triage",
    ),
)
