"""Evaluate a trusted application adapter against frozen external-harness cases.

The adapter receives JSON on stdin and returns JSON on stdout. The server never
executes it. Invoke this local CLI explicitly; this is not an OS sandbox.
"""

import argparse
import hashlib
import json
import os
import re
import signal
import subprocess
import tempfile
from contextlib import suppress
from pathlib import Path
from time import perf_counter
from typing import Literal
from uuid import uuid4

import httpx
from pydantic import Field

from autoeval_api.harness_proxy import loopback_url
from autoeval_api.harness_schemas import (
    ApplicationCase,
    ConnectHarness,
    HarnessModel,
    HarnessRun,
    HarnessSuite,
    HarnessTask,
)
from autoeval_api.hashing import hash_json

MAX_OUTPUT = 1_000_000


class ApplicationManifest(HarnessModel):
    schema_version: Literal[1]
    system: ConnectHarness
    tasks: list[HarnessTask] = Field(min_length=1, max_length=100)
    suite: HarnessSuite


def inspect_manifest(path: Path) -> ApplicationManifest:
    if path.stat().st_size > 512_000:
        raise ValueError("Manifest exceeds 512 KB")
    manifest = ApplicationManifest.model_validate_json(path.read_bytes())
    keys = [task.key for task in manifest.tasks]
    if len(set(keys)) != len(keys) or set(keys) != set(manifest.suite.task_keys):
        raise ValueError("Manifest must contain exactly the suite's unique task keys")
    if len(set(manifest.suite.task_keys)) != len(keys):
        raise ValueError("Duplicate suite task keys")
    if any(task.application_case is None for task in manifest.tasks):
        raise ValueError("Every task must declare application_case")
    return manifest


def onboard(client: httpx.Client, manifest: ApplicationManifest) -> dict:
    """Validated before writes; existing endpoints make exact retries idempotent."""
    prefix = f"/api/harnesses/{manifest.system.key}"
    response = client.post("/api/harnesses", json=manifest.system.model_dump())
    response.raise_for_status()
    for task in manifest.tasks:
        response = client.post(f"{prefix}/tasks", json=task.model_dump())
        response.raise_for_status()
    response = client.post(f"{prefix}/suites", json=manifest.suite.model_dump())
    response.raise_for_status()
    return response.json()


def grade(case: ApplicationCase, output: object) -> dict[str, bool]:
    results = {}
    for check in case.checks:
        value = output
        try:
            for part in check.path:
                if (
                    isinstance(value, dict)
                    and isinstance(part, str)
                    or isinstance(value, list)
                    and type(part) is int
                    and part >= 0
                ):
                    value = value[part]
                else:
                    raise KeyError(part)
            # JSON equality keeps true distinct from 1; absent is not null.
            results[check.name] = hash_json(value) == hash_json(check.equals)
        except (KeyError, IndexError):
            results[check.name] = False
    return results


def execute_adapter(command: list[str], cwd: Path, request: dict, timeout: float) -> dict:
    with (
        tempfile.TemporaryFile() as stdin,
        tempfile.TemporaryFile() as stdout,
        tempfile.TemporaryFile() as stderr,
    ):
        stdin.write(json.dumps(request, allow_nan=False).encode())
        stdin.seek(0)
        process = subprocess.Popen(
            command, cwd=cwd, stdin=stdin, stdout=stdout, stderr=stderr, start_new_session=True
        )
        problem = None
        try:
            deadline = perf_counter() + timeout
            while True:
                # Inspect sizes even when a fast subprocess already exited.
                if (
                    max(os.fstat(stdout.fileno()).st_size, os.fstat(stderr.fileno()).st_size)
                    > MAX_OUTPUT
                ):
                    problem = "adapter_output"
                    break
                if process.poll() is not None:
                    break
                if perf_counter() >= deadline:
                    problem = "adapter_timeout"
                    break
                with suppress(subprocess.TimeoutExpired):
                    process.wait(timeout=0.02)
        finally:
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        if problem or process.returncode:
            return {"error_code": problem or "adapter_exit"}
        stdout.seek(0)
        raw = stdout.read(MAX_OUTPUT + 1)
        try:
            envelope = json.loads(raw)
            if (
                not isinstance(envelope, dict)
                or set(envelope) != {"schema_version", "model", "mode", "output"}
                or type(envelope["schema_version"]) is not int
                or envelope["schema_version"] != 1
                or envelope["model"] != request["model"]
                or envelope["mode"] != request["mode"]
            ):
                raise ValueError("Invalid adapter envelope")
            # Reject non-finite JSON, including values in unscored output fields.
            json.dumps(envelope, allow_nan=False)
        except (ValueError, UnicodeError, RecursionError):
            return {"error_code": "adapter_protocol"}
        return {"output": envelope["output"], "hash": hashlib.sha256(raw).hexdigest()}


def run_suite(
    suite: dict,
    repository: Path,
    command: list[str],
    model: str,
    revision: str,
    mode: str,
    timeout: float,
    label: str,
    settings_hash: str,
) -> dict:
    frozen = {key: value for key, value in suite.items() if key not in {"id", "content_hash"}}
    if hash_json(frozen) != suite["content_hash"]:
        raise ValueError("Frozen suite hash mismatch")
    if not 0 < timeout <= 3600 or mode not in {"offline", "live"} or not command:
        raise ValueError("Invalid execution settings")
    tasks = [HarnessTask.model_validate(task) for task in suite["tasks"]]
    if any(task.application_case is None for task in tasks):
        raise ValueError("Application runner requires application cases")
    results = []
    for task in tasks:
        for repetition in range(1, suite["repetitions"] + 1):
            started = perf_counter()
            request = {
                "schema_version": 1,
                "model": model,
                "mode": mode,
                "input": task.application_case.input,
            }
            try:
                response = execute_adapter(command, repository, request, timeout)
            except OSError:
                response = {"error_code": "adapter_exit"}
            error = response.get("error_code")
            checks = None if error else grade(task.application_case, response["output"])
            results.append(
                {
                    "task_key": task.key,
                    "repetition": repetition,
                    "status": "timeout"
                    if error == "adapter_timeout"
                    else "error"
                    if error
                    else "completed",
                    "test_exit_code": None if error else 0 if all(checks.values()) else 1,
                    "test_output_hash": response.get("hash"),
                    "checks": checks,
                    "error_code": error,
                    "latency_ms": (perf_counter() - started) * 1000,
                }
            )
    return HarnessRun(
        request_id=str(uuid4()),
        suite_id=suite["id"],
        label=label,
        model=model,
        harness_revision=revision,
        execution_mode=mode,
        configuration_hash=hash_json(
            {
                "command": command,
                "timeout": timeout,
                "settings_hash": settings_hash,
                "mode": mode,
                "protocol": 1,
            }
        ),
        results=results,
    ).model_dump()


def summarize(result: dict) -> dict:
    cases = result["results"]
    passed = sum(case["status"] == "completed" and case["test_exit_code"] == 0 for case in cases)
    return {
        "mode": result["execution_mode"],
        "passed": passed,
        "total": len(cases),
        "failures": [
            {
                "task": case["task_key"],
                "repetition": case["repetition"],
                "error": case.get("error_code"),
                "checks": [
                    name for name, passed in (case.get("checks") or {}).items() if not passed
                ],
            }
            for case in cases
            if case["status"] != "completed" or case["test_exit_code"] != 0
        ],
    }


def compare(baseline: dict, candidate: dict) -> dict:
    baseline = HarnessRun.model_validate(baseline).model_dump()
    candidate = HarnessRun.model_validate(candidate).model_dump()
    for field in ("suite_id", "model", "execution_mode", "configuration_hash"):
        if baseline[field] != candidate[field]:
            raise ValueError("Comparison requires the same suite, model, mode and settings")

    def indexed(run):
        rows = {(item["task_key"], item["repetition"]): item for item in run["results"]}
        if len(rows) != len(run["results"]):
            raise ValueError("Duplicate result identity")
        return rows

    before, after = indexed(baseline), indexed(candidate)
    if before.keys() != after.keys():
        raise ValueError("Comparison requires matching case matrices")
    changes = []
    for key, old in before.items():
        new = after[key]
        if (old["status"], old["test_exit_code"], old["checks"]) != (
            new["status"],
            new["test_exit_code"],
            new["checks"],
        ):
            changes.append(
                {
                    "task": key[0],
                    "repetition": key[1],
                    "before": {"status": old["status"], "checks": old["checks"]},
                    "after": {"status": new["status"], "checks": new["checks"]},
                }
            )
    return {"baseline": summarize(baseline), "candidate": summarize(candidate), "changes": changes}


def require_revision(repository: Path, revision: str) -> None:
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("Candidate revision must be a full Git commit SHA")
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repository, text=True).strip()
    dirty = subprocess.check_output(["git", "status", "--porcelain"], cwd=repository)
    if head != revision or dirty:
        raise ValueError("Candidate checkout must be clean and at the declared revision")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    commands = parser.add_subparsers(dest="action", required=True)
    for action in ("inspect", "onboard"):
        sub = commands.add_parser(action)
        sub.add_argument("manifest", type=Path)
    comparison = commands.add_parser("compare")
    comparison.add_argument("baseline", type=Path)
    comparison.add_argument("candidate", type=Path)
    run = commands.add_parser("run")
    for name in ("system", "suite", "model", "revision", "label"):
        run.add_argument(f"--{name}", required=True)
    run.add_argument("--mode", choices=["offline", "live"], required=True)
    run.add_argument("--repository", type=Path, required=True)
    run.add_argument("--config", type=Path, required=True, help="Non-secret adapter settings")
    run.add_argument("--output", type=Path, required=True)
    run.add_argument("--timeout", type=int, default=120)
    run.add_argument("--allow-local-execution", action="store_true", required=True)
    run.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    try:
        if args.action == "compare":
            print(
                json.dumps(
                    compare(
                        json.loads(args.baseline.read_bytes()),
                        json.loads(args.candidate.read_bytes()),
                    ),
                    indent=2,
                )
            )
            return
        if args.action == "inspect":
            manifest = inspect_manifest(args.manifest)
            print(
                json.dumps(
                    {
                        "system": manifest.system.key,
                        "cases": len(manifest.tasks),
                        "manifest_hash": hash_json(manifest.model_dump()),
                    }
                )
            )
            return
        with httpx.Client(base_url=loopback_url(args.api), trust_env=False, timeout=30) as client:
            if args.action == "onboard":
                print(json.dumps(onboard(client, inspect_manifest(args.manifest))))
                return
            if not re.fullmatch(r"[a-z][a-z0-9-]{1,99}", args.system):
                raise ValueError("Invalid system key")
            command = args.command[1:] if args.command[:1] == ["--"] else args.command
            require_revision(args.repository, args.revision)
            response = client.get(f"/api/harnesses/{args.system}")
            response.raise_for_status()
            suite = next((s for s in response.json()["suites"] if s["id"] == args.suite), None)
            if suite is None:
                raise ValueError("Frozen suite not found")
            result = run_suite(
                suite,
                args.repository,
                command,
                args.model,
                args.revision,
                args.mode,
                args.timeout,
                args.label,
                hashlib.sha256(args.config.read_bytes()).hexdigest(),
            )
            require_revision(args.repository, args.revision)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            # Contains only check booleans, hashes and declared provenance, never raw output.
            args.output.write_text(json.dumps(result, indent=2) + "\n")
            response = client.post(f"/api/harnesses/{args.system}/runs", json=result)
            response.raise_for_status()
            summary = summarize(result)
            print(json.dumps({"saved": str(args.output), "receipt": response.json(), **summary}))
            if summary["passed"] != summary["total"]:
                parser.exit(1, "Evaluation saved; one or more cases failed.\n")
    except (ValueError, OSError, subprocess.SubprocessError, httpx.HTTPError):
        # Neither child stderr nor upstream bodies/credential-bearing URLs belong in logs.
        parser.exit(
            2,
            "Application benchmark failed. Check manifest, revision, API and adapter settings.\n",
        )


if __name__ == "__main__":
    main()
