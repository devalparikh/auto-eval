import asyncio
import json
import os
import signal
from contextlib import suppress
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


READ_CHUNK_BYTES = 64 * 1024
CLEANUP_TIMEOUT_SECONDS = 5


class _OutputLimitExceeded(Exception):
    pass


async def _stop(process: asyncio.subprocess.Process) -> None:
    # Descendants can keep the pipes open after the CLI itself exits. Every CLI
    # gets its own process group so cleanup also stops those descendants.
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        elif process.returncode is None:
            process.kill()
    except ProcessLookupError:
        pass

    async def drain(stream: asyncio.StreamReader | None) -> None:
        if stream is not None:
            while await stream.read(READ_CHUNK_BYTES):
                pass

    # wait() alone can deadlock when a cancelled reader left a full pipe. Keep
    # draining without retaining output, and bound cleanup as well as execution.
    with suppress(TimeoutError):
        await asyncio.wait_for(
            asyncio.gather(drain(process.stdout), drain(process.stderr), process.wait()),
            timeout=CLEANUP_TIMEOUT_SECONDS,
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
            start_new_session=os.name == "posix",
        )
        try:
            stdout = await asyncio.wait_for(
                self._run(process, prompt.encode()), timeout=self.settings.cli_timeout_seconds
            )
        except TimeoutError:
            await _stop(process)
            raise RuntimeError("CLI inference timed out") from None
        except _OutputLimitExceeded:
            await _stop(process)
            raise RuntimeError("CLI inference output exceeded the configured limit") from None
        except asyncio.CancelledError:
            await _stop(process)
            raise

        if process.returncode != 0:
            raise RuntimeError(f"CLI inference failed with exit code {process.returncode}")

        raw_text = stdout.decode(errors="replace").strip()
        parsed = json.loads(raw_text)
        if not isinstance(parsed, dict):
            raise ValueError("CLI inference output must be a JSON object")
        return InferenceResponse(output=parsed, raw_text=raw_text)

    async def _run(self, process: asyncio.subprocess.Process, prompt: bytes) -> bytes:
        """Feed the prompt and collect stdout, enforcing the limit while reading.

        `communicate()` buffers both streams in full before anything can be
        measured, so a chatty process could hold unbounded memory until the
        timeout. Here stdout stops at the limit and stderr, which is never
        returned or stored, is read and discarded.
        """
        stdin, stdout, stderr = process.stdin, process.stdout, process.stderr
        if stdin is None or stdout is None or stderr is None:
            raise RuntimeError("CLI process pipes are unavailable")
        limit = self.settings.cli_output_limit_bytes

        async def feed() -> None:
            try:
                stdin.write(prompt)
                await stdin.drain()
            except (BrokenPipeError, ConnectionResetError):
                pass  # the process stopped reading; its exit status reports why
            finally:
                stdin.close()

        async def collect(stream: asyncio.StreamReader) -> bytes:
            output = bytearray()
            while chunk := await stream.read(READ_CHUNK_BYTES):
                output.extend(chunk)
                if len(output) > limit:
                    raise _OutputLimitExceeded
            return bytes(output)

        async def discard(stream: asyncio.StreamReader) -> None:
            while await stream.read(READ_CHUNK_BYTES):
                pass

        tasks = [
            asyncio.ensure_future(feed()),
            asyncio.ensure_future(collect(stdout)),
            asyncio.ensure_future(discard(stderr)),
        ]
        try:
            await asyncio.gather(*tasks)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
        await process.wait()
        return tasks[1].result()
