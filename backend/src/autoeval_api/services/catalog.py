from sqlalchemy.orm import Session

from autoeval_api.inference.registry import InferenceProviderRegistry
from autoeval_api.models import AgentSystemRecord, DatasetRecord, PromptRecord
from autoeval_api.schemas import CatalogResponse, ModelOption
from autoeval_api.services.datasets import dataset_summary
from autoeval_api.services.versioning import agent_system_summary, prompt_summary


def catalog_response(
    session: Session, provider_registry: InferenceProviderRegistry
) -> CatalogResponse:
    systems = session.query(AgentSystemRecord).order_by(AgentSystemRecord.name).all()
    prompts = session.query(PromptRecord).order_by(PromptRecord.name).all()
    datasets = session.query(DatasetRecord).order_by(DatasetRecord.name).all()
    return CatalogResponse(
        agent_systems=[agent_system_summary(session, item) for item in systems],
        prompts=[prompt_summary(session, item) for item in prompts],
        datasets=[dataset_summary(session, item) for item in datasets],
        models=[
            ModelOption(
                id=model.id,
                provider=model.provider,
                label=model.label,
                supports=list(model.supports),
                available=model.available,
                notice=model.notice,
                blocked_agent_system_keys=list(model.blocked_agent_system_keys),
            )
            for model in provider_registry.models()
        ],
    )
