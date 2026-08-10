import pytest

from autoeval_api.config import Settings
from autoeval_api.inference.base import InferenceRequest
from autoeval_api.inference.cli import CODEX_COMMAND, CliInferenceProvider


def test_codex_command_uses_ephemeral_isolated_configuration() -> None:
    assert "--ephemeral" in CODEX_COMMAND
    assert "--ignore-user-config" in CODEX_COMMAND
    assert "--skip-git-repo-check" in CODEX_COMMAND
    assert CODEX_COMMAND[CODEX_COMMAND.index("--sandbox") + 1] == "read-only"


@pytest.mark.asyncio
async def test_cli_failure_does_not_expose_stderr(monkeypatch) -> None:
    class FailedProcess:
        returncode = 2

        async def communicate(self, _prompt: bytes) -> tuple[bytes, bytes]:
            return b"", b"secret from local CLI configuration"

    async def create_process(*_args, **_kwargs):
        return FailedProcess()

    monkeypatch.setattr("autoeval_api.inference.cli.asyncio.create_subprocess_exec", create_process)
    provider = CliInferenceProvider(Settings(AUTOEVAL_ENV="test", ENABLE_CLI_PROVIDERS=True))
    request = InferenceRequest(
        model_id="cli/codex",
        system_prompt="system",
        task="task",
        state={"input": {"text": "example"}},
    )

    with pytest.raises(RuntimeError, match="exit code 2") as raised:
        await provider.complete(request)

    assert "secret" not in str(raised.value)
