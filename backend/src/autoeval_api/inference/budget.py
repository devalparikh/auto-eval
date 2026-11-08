import math
from dataclasses import dataclass

from autoeval_api.inference.base import InferenceResponse


@dataclass
class InferenceBudget:
    max_calls: int
    max_tokens: int
    max_cost_usd: float
    calls: int = 0
    tokens: int = 0
    cost_usd: float = 0

    def reserve_call(self) -> None:
        if self.calls >= self.max_calls:
            raise RuntimeError("Evaluation provider-call limit reached")
        if self.tokens >= self.max_tokens or self.cost_usd >= self.max_cost_usd:
            raise RuntimeError("Evaluation token or spend limit reached")
        # Reserve before awaiting the provider, including calls that fail.
        self.calls += 1

    def record(self, response: InferenceResponse) -> None:
        if (
            not math.isfinite(response.cost_usd)
            or response.cost_usd < 0
            or response.input_tokens < 0
            or response.output_tokens < 0
        ):
            raise RuntimeError("Provider returned invalid usage accounting")
        self.tokens += response.input_tokens + response.output_tokens
        self.cost_usd += response.cost_usd

    def require_within_limits(self) -> None:
        if self.tokens > self.max_tokens or self.cost_usd > self.max_cost_usd:
            raise RuntimeError("Evaluation token or spend limit exceeded")
