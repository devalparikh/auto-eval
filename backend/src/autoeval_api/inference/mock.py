import hashlib
import json
import re
from typing import Any

from autoeval_api.inference.base import (
    InferenceRequest,
    InferenceResponse,
    ModelDescriptor,
)


class MockInferenceProvider:
    provider_id = "mock"

    def models(self) -> list[ModelDescriptor]:
        return [
            ModelDescriptor(
                id="mock/incident-specialist",
                provider=self.provider_id,
                label="Mock incident specialist",
                supports=("text", "image", "audio"),
            ),
            ModelDescriptor(
                id="mock/incident-fast",
                provider=self.provider_id,
                label="Mock incident fast",
                supports=("text",),
            ),
            ModelDescriptor(
                id="mock/portfolio-analyst",
                provider=self.provider_id,
                label="Mock portfolio analyst",
                supports=("text",),
            ),
            ModelDescriptor(
                id="mock/portfolio-fast",
                provider=self.provider_id,
                label="Mock portfolio fast",
                supports=("text",),
            ),
        ]

    async def complete(self, request: InferenceRequest) -> InferenceResponse:
        if request.task == "classify_incident":
            output = self._classify(request)
        elif request.task == "draft_response":
            output = self._draft(request)
        elif request.task == "extract_portfolio_context":
            output = {"context_patch": request.state.get("normalized", {})}
        elif request.task == "explain_portfolio":
            output = self._explain_portfolio(request)
        elif request.task == "explain_portfolio_query":
            output = self._explain_portfolio_query(request)
        else:
            output = {"result": "Mock provider completed the requested task."}

        raw_text = json.dumps(output, sort_keys=True)
        input_text = json.dumps(request.state, sort_keys=True)
        input_tokens = max(1, len(input_text) // 4)
        output_tokens = max(1, len(raw_text) // 4)
        multiplier = 1.0 if request.model_id.endswith("specialist") else 0.35
        return InferenceResponse(
            output=output,
            raw_text=raw_text,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=round((input_tokens * 0.0000003 + output_tokens * 0.0000006) * multiplier, 8),
            metadata={"deterministic": True},
        )

    def _classify(self, request: InferenceRequest) -> dict[str, Any]:
        incident = request.state.get("normalized", request.state.get("input", {}))
        text = str(incident.get("text", "")).lower()

        security_words = ("breach", "credential", "token leaked", "ransomware", "unauthorized")
        availability_words = ("down", "outage", "unavailable", "5xx", "cannot access")
        data_words = ("data loss", "corrupt", "deleted", "missing records")
        payment_words = ("payment", "checkout", "charge", "billing")

        if any(word in text for word in security_words):
            severity, route = "critical", "security"
        elif any(word in text for word in data_words):
            severity, route = "critical", "data"
        elif any(word in text for word in availability_words):
            severity, route = "high", "platform"
        elif any(word in text for word in payment_words):
            severity, route = "high", "payments"
        else:
            severity, route = "medium", "support"

        if request.model_id.endswith("fast") and self._should_degrade(text):
            severity = "medium" if severity == "high" else severity

        confidence = 0.96 if severity == "critical" else 0.89
        return {
            "classification": {
                "severity": severity,
                "route": route,
                "confidence": confidence,
                "evidence": self._evidence(text),
            }
        }

    def _draft(self, request: InferenceRequest) -> dict[str, Any]:
        classification = request.state.get("classification", {})
        policy = request.state.get("policy", {})
        severity = classification.get("severity", "medium")
        route = classification.get("route", "support")
        response = (
            f"Incident classified as {severity}. Route to {route}. "
            f"{policy.get('next_action', 'Review the report and confirm impact.')}"
        )
        return {
            "output": {
                "severity": severity,
                "route": route,
                "requires_human": policy.get("requires_human", True),
                "response": response,
            }
        }

    @staticmethod
    def _explain_portfolio(request: InferenceRequest) -> dict[str, Any]:
        analysis = request.state.get("analysis", {})
        if not analysis.get("analysis_ready"):
            return {
                "portfolio_explanation": {
                    "observations": [],
                    "feedback": analysis.get("next_question"),
                }
            }
        metrics = analysis.get("metrics", {})
        top_symbol = metrics.get("top_holding_symbol", "the largest holding")
        top_weight = float(metrics.get("top_holding_weight", 0))
        observations = [
            f"{top_symbol} is the largest position at {top_weight:.1%} of the portfolio."
        ]
        gaps = [item for item in metrics.get("bucket_gaps", []) if item.get("status") != "within"]
        if gaps:
            observations.append(
                "At least one user-defined portfolio bucket is outside its confirmed range."
            )
        scenarios = metrics.get("scenarios", [])
        if scenarios:
            worst = min(scenarios, key=lambda item: item.get("estimated_return", 0))
            observations.append(
                f"The supplied {worst['name']} scenario estimates a "
                f"{float(worst['estimated_return']):.1%} portfolio move."
            )
        return {
            "portfolio_explanation": {
                "observations": observations,
                "feedback": (
                    "Review concentration, bucket ranges, and scenario assumptions against "
                    "the stated goal, horizon, risk tolerance, and liquidity need."
                ),
            }
        }

    @staticmethod
    def _explain_portfolio_query(request: InferenceRequest) -> dict[str, Any]:
        context = request.state.get("portfolio_model_context", {})
        status = context.get("status")
        candidates = context.get("candidates", [])
        fact_ids: list[str] = []
        candidate_ids: list[str] = []
        if status == "candidates" and candidates:
            leader = candidates[0]
            candidate_ids = [str(leader.get("candidate_id"))]
            summary = (
                f"{leader.get('candidate_id')} ranks first among the supplied contracts "
                "after coverage, liquidity, assignment, event, and quote checks."
            )
            risks = [
                "Assignment can sell the covered shares at the strike price.",
                "Option quotes and Greeks can change before an order is reviewed.",
            ]
        elif status == "needs_market_data":
            summary = "Fresh supplied option-chain data is required before ranking candidates."
            risks = ["Stale quotes cannot support an actionable comparison."]
        elif status == "blocked":
            summary = "No supplied contract passed every deterministic portfolio policy check."
            risks = ["Relaxing safeguards changes assignment and liquidity exposure."]
        elif status == "ready":
            facts = context.get("portfolio_facts", {})
            position_facts = facts.get("position_facts", [])
            if position_facts:
                fact_ids = [str(position_facts[0].get("fact_id"))]
            summary = (
                f"The indexed snapshot contains {facts.get('position_count', 0)} positions; "
                f"{facts.get('largest_symbol', 'none')} is the largest supplied weight."
            )
            risks = ["The answer is limited to the indexed snapshot fields supplied."]
        else:
            summary = "More indexed portfolio context is required to answer this question."
            risks = ["Missing context can make portfolio conclusions incomplete."]
        return {
            "answer": {
                "summary": summary,
                "assumptions": [
                    "The indexed snapshot and market context are user-supplied and accurate."
                ],
                "risks": risks,
                "fact_ids": fact_ids,
                "candidate_ids": candidate_ids,
            }
        }

    @staticmethod
    def _should_degrade(text: str) -> bool:
        digest = hashlib.sha256(text.encode()).digest()
        return digest[0] % 4 == 0

    @staticmethod
    def _evidence(text: str) -> list[str]:
        words = re.findall(r"[a-z0-9]+", text)
        return words[:6]
