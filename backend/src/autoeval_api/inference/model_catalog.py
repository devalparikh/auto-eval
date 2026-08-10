from dataclasses import dataclass
from typing import Literal

from autoeval_api.inference.base import ModelDescriptor


@dataclass(frozen=True)
class OpenRouterModelConfig:
    slug: str
    label: str
    supports: tuple[str, ...]
    supported_parameters: frozenset[str]
    data_collection: Literal["allow", "deny"] = "deny"
    requires_synthetic_input: bool = False
    notice: str | None = None
    blocked_agent_system_keys: tuple[str, ...] = ()
    zdr_output_token_parameter: Literal["max_tokens", "max_completion_tokens"] | None = None

    def descriptor(self, available: bool) -> ModelDescriptor:
        return ModelDescriptor(
            id=f"openrouter/{self.slug}",
            provider="openrouter",
            label=self.label,
            supports=self.supports,
            available=available,
            notice=self.notice,
            blocked_agent_system_keys=self.blocked_agent_system_keys,
        )


OPENROUTER_MODELS = (
    OpenRouterModelConfig(
        slug="openai/gpt-5.6-luna",
        label="OpenAI GPT-5.6 Luna",
        supports=("text", "image", "file"),
        supported_parameters=frozenset(
            {
                "max_completion_tokens",
                "max_tokens",
                "response_format",
                "seed",
                "structured_outputs",
            }
        ),
        zdr_output_token_parameter="max_completion_tokens",
    ),
    OpenRouterModelConfig(
        slug="deepseek/deepseek-v4-flash",
        label="DeepSeek V4 Flash",
        supports=("text",),
        supported_parameters=frozenset(
            {"max_tokens", "response_format", "seed", "temperature", "structured_outputs"}
        ),
    ),
    OpenRouterModelConfig(
        slug="nvidia/nemotron-3-ultra-550b-a55b:free",
        label="NVIDIA Nemotron 3 Ultra (free)",
        supports=("text",),
        supported_parameters=frozenset({"max_tokens", "seed", "temperature"}),
        data_collection="allow",
        requires_synthetic_input=True,
        notice=(
            "Free endpoint: use synthetic, non-confidential inputs only; NVIDIA may log data "
            "for product improvement. It is disabled for portfolio workflows."
        ),
        blocked_agent_system_keys=("portfolio-analyst", "portfolio-query"),
    ),
    OpenRouterModelConfig(
        slug="openai/gpt-5-mini",
        label="OpenAI GPT-5 mini",
        supports=("text", "image"),
        supported_parameters=frozenset({"max_tokens", "response_format", "temperature"}),
    ),
    OpenRouterModelConfig(
        slug="anthropic/claude-sonnet-4.5",
        label="Claude Sonnet 4.5",
        supports=("text", "image"),
        supported_parameters=frozenset({"max_tokens", "response_format", "temperature"}),
    ),
    OpenRouterModelConfig(
        slug="google/gemini-2.5-flash",
        label="Gemini 2.5 Flash",
        supports=("text", "image", "audio"),
        supported_parameters=frozenset({"max_tokens", "response_format", "temperature"}),
    ),
)


def openrouter_model(model_id: str) -> OpenRouterModelConfig:
    slug = model_id.removeprefix("openrouter/")
    try:
        return next(model for model in OPENROUTER_MODELS if model.slug == slug)
    except StopIteration as error:
        raise ValueError(f"Unsupported OpenRouter model: {slug}") from error
