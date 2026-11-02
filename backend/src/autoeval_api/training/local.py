import asyncio
import importlib.util
import json
import math
import os
import platform
import re
import signal
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

from autoeval_api.schemas import TrainingBaseModel, TrainingRuntime

BASE_MODELS = [
    TrainingBaseModel(
        id="mlx-community/Qwen2.5-0.5B-Instruct-4bit",
        label="Qwen 2.5 · 0.5B",
        description="Smallest starter · 4-bit weights",
    ),
    TrainingBaseModel(
        id="mlx-community/Qwen2.5-1.5B-Instruct-4bit",
        label="Qwen 2.5 · 1.5B",
        description="More capacity · 4-bit weights",
    ),
    TrainingBaseModel(
        id="mlx-community/Llama-3.2-1B-Instruct-4bit",
        label="Llama 3.2 · 1B",
        description="Compact Llama · check model license",
    ),
]


def worker_environment() -> dict[str, str]:
    # Provider and application secrets do not belong in a training worker.
    allowed = {"PATH", "HOME", "TMPDIR", "SYSTEMROOT", "LANG", "LC_ALL", "HF_TOKEN"}
    env = {key: value for key, value in os.environ.items() if key in allowed}
    env.update(
        {
            "PYTHONPATH": str(Path(__file__).resolve().parents[2]),
            "PYTHONUNBUFFERED": "1",
            "HF_HUB_DISABLE_TELEMETRY": "1",
            "HF_HUB_DISABLE_PROGRESS_BARS": "1",
            "TOKENIZERS_PARALLELISM": "false",
            "HF_HUB_DOWNLOAD_TIMEOUT": "60",
            "HF_HUB_ETAG_TIMEOUT": "30",
        }
    )
    return env


class LocalTrainer:
    """One local executor; keep dispatch separate from persistence for future cloud jobs."""

    def runtime(self, *, production: bool = False) -> TrainingRuntime:
        reason = "Ready for local LoRA training on Apple Silicon."
        available = False
        if production:
            reason = "Local training is available only in the local workbench."
        elif platform.system() != "Darwin" or platform.machine() != "arm64":
            reason = "Local training currently requires an Apple Silicon Mac."
        elif importlib.util.find_spec("mlx_lm") is None:
            reason = "Install the optional MLX training dependencies, then refresh."
        else:
            try:
                result = subprocess.run(
                    [sys.executable, "-m", "autoeval_api.training.worker", "--check"],
                    env=worker_environment(),
                    capture_output=True,
                    timeout=30,
                    check=False,
                )
                available = result.returncode == 0 and b"MLX_READY" in result.stdout
                if not available:
                    reason = "MLX could not access the GPU. Check the install and Metal support."
            except (OSError, subprocess.TimeoutExpired):
                reason = "MLX readiness check failed. Check the local Python training environment."
        return TrainingRuntime(available=available, reason=reason, base_models=BASE_MODELS)

    async def run(
        self,
        directory: Path,
        timeout: int,
        progress: Callable[[str, dict[str, int | float | str]], None],
    ) -> str:
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            "autoeval_api.training.worker",
            str(directory),
            str(os.getpid()),
            env=worker_environment(),
            cwd=directory,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            start_new_session=True,
        )
        tail = ""
        pending = ""
        try:
            async with asyncio.timeout(timeout):
                assert process.stdout is not None
                while chunk := await process.stdout.read(4096):
                    pending += chunk.decode("utf-8", errors="replace")
                    lines = pending.split("\n")
                    pending = lines.pop()[-16_000:]
                    for line in lines:
                        metrics = {}
                        if line.startswith("AUTOEVAL_PROGRESS "):
                            payload = json.loads(line.removeprefix("AUTOEVAL_PROGRESS "))
                            metrics: dict[str, int | float | str] = {
                                key: value
                                for key, value in payload.items()
                                if key in {"completed_steps", "training_loss", "validation_loss"}
                                and isinstance(value, (int, float))
                                and math.isfinite(value)
                            }
                            revision = payload.get("resolved_revision")
                            if isinstance(revision, str) and re.fullmatch(
                                r"[a-f0-9]{40,64}", revision
                            ):
                                metrics["resolved_revision"] = revision
                        else:
                            # Defensive redaction for any library that prints an auth token.
                            token = os.environ.get("HF_TOKEN")
                            if token:
                                line = line.replace(token, "[redacted]")
                            tail = (tail + line + "\n")[-16_000:]
                        progress(tail, metrics)
                code = await process.wait()
                if code != 0:
                    raise RuntimeError("Training failed. See the training log for details.")
        finally:
            if process.returncode is None:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                    await asyncio.wait_for(process.wait(), timeout=5)
                except TimeoutError:
                    os.killpg(process.pid, signal.SIGKILL)
                    await process.wait()
                except ProcessLookupError:
                    await process.wait()
        adapter = directory / "adapter" / "adapters.safetensors"
        if not adapter.is_file() or not adapter.stat().st_size:
            raise RuntimeError("Training exited without saved adapter weights")
        result = json.loads((directory / "result.json").read_text())
        return str(result["revision"])
