import json
import sys

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from autoeval_api.app import create_application
from autoeval_api.application_benchmark import (
    grade,
    inspect_manifest,
    onboard,
    run_suite,
)
from autoeval_api.harness_schemas import ApplicationCase, HarnessTask
from autoeval_api.services.versioning import hash_json


def task():
    return {
        "key": "greeting",
        "partition": "benchmark",
        "prompt": "Synthetic greeting",
        "repository_revision": "a" * 40,
        "application_case": {
            "input": {"message": "Hi"},
            "checks": [
                {"name": "no_writes", "path": ["writes"], "equals": 0},
                {"name": "reply", "path": ["reply"], "equals": "Hello"},
            ],
        },
    }


def frozen_suite():
    document = {"name": "test", "repetitions": 1, "tasks": [task()]}
    return {"id": "suite", "content_hash": hash_json(document), **document}


def adapter(tmp_path, body):
    path = tmp_path / "adapter.py"
    path.write_text("import json, sys\nr = json.load(sys.stdin)\n" + body)
    return [sys.executable, str(path)]


def evaluate(tmp_path, command, suite=None, timeout=2):
    return run_suite(
        suite or frozen_suite(),
        tmp_path,
        command,
        "scripted/v1",
        "b" * 40,
        "offline",
        timeout,
        "Regression",
        "c" * 64,
    )


def test_generic_checks_distinguish_missing_null_boolean_and_array_indices():
    case = ApplicationCase(
        input={},
        checks=[
            {"name": "missing", "path": ["missing"], "equals": None},
            {"name": "null", "path": ["null"], "equals": None},
            {"name": "boolean", "path": ["boolean"], "equals": 1},
            {"name": "array", "path": ["array", 0], "equals": "yes"},
            {"name": "negative", "path": ["array", -1], "equals": "yes"},
        ],
    )
    assert grade(case, {"null": None, "boolean": True, "array": ["yes"]}) == {
        "missing": False,
        "null": True,
        "boolean": False,
        "array": True,
        "negative": False,
    }


def test_runs_real_process_grades_without_exporting_content(tmp_path):
    command = adapter(
        tmp_path,
        'print(json.dumps({"schema_version": 1, "model": r["model"], '
        '"mode": r["mode"], "output": {"writes": 0, "reply": "Hello", '
        '"private": "not-in-report"}}))\n',
    )
    result = evaluate(tmp_path, command)
    assert result["execution_mode"] == "offline"
    assert result["results"][0]["checks"] == {"no_writes": True, "reply": True}
    assert result["results"][0]["test_exit_code"] == 0
    assert "not-in-report" not in json.dumps(result)
    assert result["results"][0]["cost_usd"] is None


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ("sys.exit(1)", "adapter_exit"),
        ('print("not JSON")', "adapter_protocol"),
        ('print("x" * 1100000)', "adapter_output"),
        ("import time; time.sleep(10)", "adapter_timeout"),
        (
            'print(json.dumps({"schema_version":1,"model":"wrong","mode":"offline","output":{}}))',
            "adapter_protocol",
        ),
        (
            'print(json.dumps({"schema_version":1,"model":r["model"],"mode":"live","output":{}}))',
            "adapter_protocol",
        ),
    ],
)
def test_failures_count_and_do_not_disclose_stderr(tmp_path, body, code):
    result = evaluate(
        tmp_path, adapter(tmp_path, 'print("SECRET", file=sys.stderr)\n' + body), timeout=0.2
    )
    assert result["results"][0]["error_code"] == code
    assert result["results"][0]["status"] != "completed"
    assert "SECRET" not in json.dumps(result)


def test_tampered_suite_rejected_before_execution(tmp_path):
    suite = frozen_suite()
    suite["tasks"][0]["application_case"]["checks"][0]["equals"] = 1
    with pytest.raises(ValueError, match="hash mismatch"):
        evaluate(tmp_path, ["must-not-execute"], suite)


def test_existing_coding_task_contract_and_application_exclusivity():
    coding = {**task(), "test_command": ["pytest"]}
    with pytest.raises(ValueError):
        HarnessTask.model_validate(coding)
    coding.pop("application_case")
    assert HarnessTask.model_validate(coding).test_command == ["pytest"]
    with pytest.raises(ValueError):
        HarnessTask.model_validate({**task(), "partition": "train"})


def test_onboarding_freezes_cases_and_imports_complete_matrix(tmp_path):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    path = tmp_path / "application.json"
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "system": {"key": "test-app", "name": "Test app", "harness": "other"},
                "tasks": [task()],
                "suite": {"name": "Safety", "task_keys": ["greeting"], "repetitions": 2},
            }
        )
    )
    manifest = inspect_manifest(path)
    with TestClient(create_application(engine=engine)) as client:
        receipt = onboard(client, manifest)
        assert onboard(client, manifest) == receipt
        suite = client.get("/api/harnesses/test-app").json()["suites"][0]
        command = adapter(
            tmp_path,
            'print(json.dumps({"schema_version": 1, "model": r["model"], '
            '"mode": r["mode"], "output": {"writes": 1, "reply": "Hello"}}))',
        )
        result = evaluate(tmp_path, command, suite)
        url = "/api/harnesses/test-app/runs"
        saved = client.post(url, json=result)
        assert saved.status_code == 201, saved.text
        assert client.post(url, json=result).json() == saved.json()
        assert client.get("/api/harnesses/test-app").json()["runs"][0]["passed"] == 0
        result["results"].pop()
        assert client.post(url, json=result).status_code == 422
        altered = manifest.tasks[0].model_dump()
        altered["application_case"]["input"]["message"] = "changed"
        assert client.post("/api/harnesses/test-app/tasks", json=altered).status_code == 422
