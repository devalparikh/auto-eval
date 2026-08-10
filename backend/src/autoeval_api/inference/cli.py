import asyncio
import json
from dataclasses import dataclass

from autoeval_api.config import Settings
from autoeval_api.inference.base import (
    InferenceRequest,
    InferenceResponse,
    ModelDescriptor,
)

CODEX_COMMAND = (
    "codex",
    "exec",
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "-",
)


@dataclass(frozen=True)
class CliModel:
    descriptor: ModelDescriptor
    command: tuple[str, ...]


class CliInferenceProvider:
    """Guarded local CLI adapter. Disabled unless explicitly enabled in settings."""

    provider_id = "cli"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._models = {
            "cli/codex": CliModel(
                descriptor=ModelDescriptor(
                    id="cli/codex",
                    provider=self.provider_id,
                    label="Local Codex CLI",
                    supports=("text",),
                    available=settings.enable_cli_providers,
                ),
                command=CODEX_COMMAND,
            ),
            "cli/claude": CliModel(
                descriptor=ModelDescriptor(
                    id="cli/claude",
                    provider=self.provider_id,
                    label="Local Claude CLI",
                    supports=("text",),
                    available=settings.enable_cli_providers,
                ),
                command=(
                    "claude",
                    "--print",
                ),
            ),
        }

    def models(self) -> list[ModelDescriptor]:
        return [model.descriptor for model in self._models.values()]

    async def complete(self, request: InferenceRequest) -> InferenceResponse:
        if not self.settings.enable_cli_providers:
            raise RuntimeError("CLI inference providers are disabled")
        model = self._models.get(request.model_id)
        if model is None:
            raise ValueError(f"Unsupported CLI model: {request.model_id}")

        prompt = (
            f"{request.system_prompt}\n\n"
            f"Task: {request.task}\n"
            "Return one JSON object only.\n"
            f"State: {json.dumps(request.state, sort_keys=True)}"
        )
        process = await asyncio.create_subprocess_exec(
            *model.command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, _stderr = await asyncio.wait_for(
                process.communicate(prompt.encode()), timeout=self.settings.cli_timeout_seconds
            )
        except TimeoutError:
            process.kill()
            await process.wait()
            raise RuntimeError("CLI inference timed out") from None

        if len(stdout) > self.settings.cli_output_limit_bytes:
            raise RuntimeError("CLI inference output exceeded the configured limit")
        if process.returncode != 0:
            raise RuntimeError(f"CLI inference failed with exit code {process.returncode}")

        raw_text = stdout.decode(errors="replace").strip()
        parsed = json.loads(raw_text)
        if not isinstance(parsed, dict):
            raise ValueError("CLI inference output must be a JSON object")
        return InferenceResponse(output=parsed, raw_text=raw_text)
