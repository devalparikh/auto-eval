"""Run a frozen benchmark with a user-supplied harness command in fresh checkouts."""

import argparse
import hashlib
import json
import os
import signal
import subprocess
import tempfile
from contextlib import suppress
from pathlib import Path
from time import perf_counter
from uuid import uuid4

import httpx

from autoeval_api.harness_proxy import loopback_url


def execute(argv: list[str], cwd: Path, timeout: int, prompt: str = "") -> tuple[int, bytes, bool]:
    # Temporary files bound RAM even for verbose harnesses. Only a hash is exported.
    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as stdin:
        stdin.write(prompt.encode())
        stdin.seek(0)
        process = subprocess.Popen(
            argv,
            cwd=cwd,
            stdin=stdin,
            stdout=output,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        timed_out = False
        try:
            deadline = perf_counter() + timeout
            while process.poll() is None:
                if perf_counter() >= deadline:
                    timed_out = True
                    break
                if os.fstat(output.fileno()).st_size > 20_000_000:
                    break
                with suppress(subprocess.TimeoutExpired):
                    process.wait(timeout=0.1)
        finally:
            # Kill descendants even if the parent has already exited.
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        output.seek(0)
        digest = hashlib.file_digest(output, "sha256").digest()
        return process.returncode, digest, timed_out


def run_suite(
    suite: dict,
    repository: Path,
    command: list[str],
    model: str,
    revision: str,
    timeout: int,
    label: str,
    settings_hash: str = "",
) -> dict:
    if not any("{model}" in argument for argument in command):
        raise ValueError("Harness command must include {model} so the candidate is explicit")
    results = []
    for task in suite["tasks"]:
        for repetition in range(1, suite["repetitions"] + 1):
            started = perf_counter()
            result = {
                "task_key": task["key"],
                "repetition": repetition,
                "status": "error",
                "test_exit_code": None,
                "test_output_hash": None,
                "input_tokens": None,
                "output_tokens": None,
                "cost_usd": None,
            }
            with tempfile.TemporaryDirectory(prefix="autoeval-benchmark-") as temporary:
                checkout = Path(temporary) / "repo"
                try:
                    subprocess.run(
                        [
                            "git",
                            "clone",
                            "--quiet",
                            "--no-local",
                            "--",
                            str(repository.resolve()),
                            str(checkout),
                        ],
                        check=True,
                        timeout=60,
                        capture_output=True,
                    )
                    subprocess.run(
                        ["git", "checkout", "--quiet", "--detach", task["repository_revision"]],
                        cwd=checkout,
                        check=True,
                        timeout=30,
                        capture_output=True,
                    )
                    argv = [argument.replace("{model}", model) for argument in command]
                    code, _output_hash, timed_out = execute(argv, checkout, timeout, task["prompt"])
                    if timed_out:
                        result["status"] = "timeout"
                    elif code == 0:
                        code, output_hash, timed_out = execute(
                            task["test_command"], checkout, timeout
                        )
                        result.update(
                            status="timeout" if timed_out else "completed",
                            test_exit_code=code,
                            test_output_hash=output_hash.hex(),
                        )
                except (OSError, subprocess.SubprocessError):
                    result["status"] = "error"
            result["latency_ms"] = (perf_counter() - started) * 1000
            results.append(result)
    return {
        "request_id": str(uuid4()),
        "suite_id": suite["id"],
        "label": label,
        "model": model,
        "harness_revision": revision,
        "configuration_hash": hashlib.sha256(
            json.dumps(
                {"command": command, "timeout": timeout, "settings_hash": settings_hash},
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest(),
        "results": results,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--system", required=True)
    parser.add_argument("--suite", required=True)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument(
        "--config",
        type=Path,
        required=True,
        help="Non-secret harness configuration file included in the run identity",
    )
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--output", type=Path, default=Path(".autoeval/benchmark-result.json"))
    parser.add_argument(
        "--allow-local-execution",
        action="store_true",
        required=True,
        help="A fresh checkout is not an OS sandbox; commands run as your user",
    )
    parser.add_argument(
        "command",
        nargs=argparse.REMAINDER,
        help="After --, harness argv with {model}; prompt is supplied on stdin",
    )
    args = parser.parse_args()
    import re

    if not re.fullmatch(r"[a-z][a-z0-9-]{1,99}", args.system):
        parser.error("Invalid system key")
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command or not 1 <= args.timeout <= 3600:
        parser.error("Supply a harness command and a timeout between 1 and 3600 seconds")
    with httpx.Client(base_url=loopback_url(args.api), trust_env=False, timeout=30) as client:
        response = client.get(f"/api/harnesses/{args.system}")
        response.raise_for_status()
        suite = next((item for item in response.json()["suites"] if item["id"] == args.suite), None)
        if suite is None:
            parser.error("Benchmark not found")
        result = run_suite(
            suite,
            args.repository,
            command,
            args.model,
            args.revision,
            args.timeout,
            args.label,
            hashlib.sha256(args.config.read_bytes()).hexdigest(),
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2))
        response = client.post(f"/api/harnesses/{args.system}/runs", json=result)
        response.raise_for_status()
    print(f"Saved and submitted results to {args.output}")


if __name__ == "__main__":
    main()
