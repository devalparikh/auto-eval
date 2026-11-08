import dataclasses
import sys
import time

import pytest

from autoeval_api.config import Settings
from autoeval_api.inference.base import InferenceRequest
from autoeval_api.inference.cli import CODEX_COMMAND, CliInferenceProvider

REQUEST = InferenceRequest(
    model_id="cli/codex",
    system_prompt="system",
    task="task",
    state={"input": {"text": "example"}},
)


def _provider(script: str, **settings: object) -> CliInferenceProvider:
    """A provider whose Codex model runs `script` in a real Python child process."""
    provider = CliInferenceProvider(
        Settings(AUTOEVAL_ENV="test", ENABLE_CLI_PROVIDERS=True, **settings)
    )
    model = provider._models["cli/codex"]
    provider._models["cli/codex"] = dataclasses.replace(
        model, command=(sys.executable, "-c", script)
    )
    return provider


def test_codex_command_uses_ephemeral_isolated_configuration() -> None:
    assert "--ephemeral" in CODEX_COMMAND
    assert "--ignore-user-config" in CODEX_COMMAND
    assert "--skip-git-repo-check" in CODEX_COMMAND
    assert CODEX_COMMAND[CODEX_COMMAND.index("--sandbox") + 1] == "read-only"


@pytest.mark.asyncio
async def test_cli_reads_the_prompt_from_stdin_and_parses_its_json_output() -> None:
    provider = _provider(
        "import json, sys; prompt = sys.stdin.read(); "
        "print(json.dumps({'saw_task': 'Task: task' in prompt}))"
    )

    response = await provider.complete(REQUEST)

    assert response.output == {"saw_task": True}


@pytest.mark.asyncio
async def test_cli_failure_does_not_expose_stderr() -> None:
    provider = _provider(
        "import sys; sys.stdin.read(); "
        "sys.stderr.write('secret from local CLI configuration'); sys.exit(2)"
    )

    with pytest.raises(RuntimeError, match="exit code 2") as raised:
        await provider.complete(REQUEST)

    assert "secret" not in str(raised.value)


@pytest.mark.asyncio
async def test_cli_output_limit_stops_a_flooding_process_without_waiting_for_the_timeout() -> None:
    # 256 KiB on each stream against a 32-byte limit, then the child would idle
    # until the timeout. The limit must end the run while the output arrives.
    provider = _provider(
        "import sys, time; sys.stdin.read(); "
        "sys.stderr.write('e' * 262144); sys.stderr.flush(); "
        "sys.stdout.write('o' * 262144); sys.stdout.flush(); time.sleep(30)",
        cli_output_limit_bytes=32,
        cli_timeout_seconds=20,
    )

    started = time.monotonic()
    with pytest.raises(RuntimeError, match="exceeded the configured limit"):
        await provider.complete(REQUEST)

    assert time.monotonic() - started < 10


@pytest.mark.asyncio
async def test_cli_stderr_is_drained_so_a_chatty_process_cannot_stall() -> None:
    # Far more stderr than a pipe buffer holds: if it were not read, the child
    # would block writing it and never produce its answer.
    provider = _provider(
        "import json, sys; sys.stdin.read(); "
        "sys.stderr.write('progress ' * 300000); sys.stderr.flush(); "
        "print(json.dumps({'ok': True}))",
        cli_output_limit_bytes=1024,
        cli_timeout_seconds=20,
    )

    response = await provider.complete(REQUEST)

    assert response.output == {"ok": True}
