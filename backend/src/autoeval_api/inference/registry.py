from collections.abc import Iterable

from autoeval_api.config import Settings
from autoeval_api.inference.base import InferenceProvider, ModelDescriptor
from autoeval_api.inference.cli import CliInferenceProvider
from autoeval_api.inference.mock import MockInferenceProvider
from autoeval_api.inference.openrouter import OpenRouterInferenceProvider


class InferenceProviderRegistry:
    def __init__(self, providers: Iterable[InferenceProvider] | Settings = ()) -> None:
        self._providers: dict[str, InferenceProvider] = {}
        if isinstance(providers, Settings):
            providers = _default_providers(providers)
        for provider in providers:
            self.register(provider)

    def register(self, provider: InferenceProvider) -> None:
        if provider.provider_id in self._providers:
            raise ValueError(f"Inference provider is already registered: {provider.provider_id}")
        self._providers[provider.provider_id] = provider

    def get_for_model(self, model_id: str) -> InferenceProvider:
        provider_id = model_id.split("/", 1)[0]
        provider = self._providers.get(provider_id)
        if provider is None:
            raise ValueError(f"Unknown inference provider: {provider_id}")
        model = next((item for item in provider.models() if item.id == model_id), None)
        if model is None:
            raise ValueError(f"Unknown model: {model_id}")
        if not model.available:
            raise RuntimeError(f"Model is not configured: {model_id}")
        return provider

    def models(self) -> list[ModelDescriptor]:
        return [model for provider in self._providers.values() for model in provider.models()]


def default_provider_registry(settings: Settings) -> InferenceProviderRegistry:
    return InferenceProviderRegistry(_default_providers(settings))


def _default_providers(settings: Settings) -> list[InferenceProvider]:
    return [
        MockInferenceProvider(),
        OpenRouterInferenceProvider(settings),
        CliInferenceProvider(settings),
    ]
