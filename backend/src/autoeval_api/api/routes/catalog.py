from fastapi import APIRouter

from autoeval_api.api.dependencies import ProviderRegistryDependency, SessionDependency
from autoeval_api.schemas import CatalogResponse
from autoeval_api.services.catalog import catalog_response

router = APIRouter()


@router.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/api/catalog", response_model=CatalogResponse)
def catalog(
    session: SessionDependency, provider_registry: ProviderRegistryDependency
) -> CatalogResponse:
    return catalog_response(session, provider_registry)
