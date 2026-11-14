# Evaluate an existing application agent

Use this route when the application already owns a tool loop, retrieval,
validation and provider selection. Do not reconstruct it as a portable graph:
that would evaluate a different program. Lifty is the first integration.

AutoEval's external harness workspace now accepts **application cases** as well
as coding tasks. Cases use the existing immutable task and frozen-suite records.
No graph or finalized dataset is edited; training export still requires reviewed
captures and creates finalized dataset versions. Application cases cannot train.
The JSON payload extension requires no database columns or migration. Existing
coding task/run hashes are preserved when the new fields are absent.

## Contract and onboarding

Prepare a JSON manifest in the agent repository:

```json
{
  "schema_version": 1,
  "system": {"key": "my-agent", "name": "My agent", "harness": "other"},
  "tasks": [{
    "key": "greeting-v1", "partition": "benchmark",
    "prompt": "A synthetic greeting should not read private records.",
    "repository_revision": "FULL_40_CHARACTER_FIXTURE_SOURCE_COMMIT",
    "application_case": {
      "input": {"message": "Hello"},
      "checks": [{"name": "no_reads", "path": ["reads"], "equals": 0}]
    }
  }],
  "suite": {"name": "Regression v1", "task_keys": ["greeting-v1"], "repetitions": 1}
}
```

`repository_revision` identifies fixture source context, not the candidate being
evaluated. The frozen suite hashes the actual input and checks. Use new task keys
and a new suite when those change. A regression suite used for tuning is not an
untouched final holdout, despite the legacy API's `benchmark` partition name.

```sh
.venv/bin/python -m autoeval_api.application_benchmark inspect /path/application.json
.venv/bin/python -m autoeval_api.application_benchmark onboard /path/application.json
```

Inspect validates without writes, execution or network. Onboard validates the
whole document, connects the system, imports tasks, then freezes a suite through
the existing API. Exact retries are idempotent. It is not one transaction across
HTTP calls: conflicts can leave already imported tasks; fix the conflict using
new keys and retry. Keep the API on loopback. The response contains the suite ID.

## Adapter protocol v1

A trusted local command reads one JSON document from stdin:

```json
{"schema_version":1,"model":"scripted/v1","mode":"offline","input":{"message":"Hello"}}
```

It writes exactly one JSON document to stdout:

```json
{"schema_version":1,"model":"scripted/v1","mode":"offline","output":{"reads":0}}
```

The application adapter calls its existing entry point with injected synthetic
records, and uses the requested model for every relevant inference call. Do not
put an implementation of the agent in the adapter. Offline mode replaces model
responses with scripted turns, and proves orchestration behavior only. Live mode
uses the real provider; synthetic records still do not prove production data or
authentication behavior. The envelope must match the requested model and mode;
these are declarations, not proof of provider routing. Audit resolved provider
identity separately before claiming a model comparison.

Checks address typed object keys and zero-based array indices. Missing paths
fail, even when the expected value is null. JSON equality distinguishes `true`
from `1`. AutoEval evaluates all checks outside the adapter; raw outputs and child
stderr are not persisted, only check results and a SHA-256 output digest. Unknown
tokens and cost remain null. A failing check counts as failure; exceptions,
invalid envelopes, model/mode mismatches, timeouts and oversize output cannot pass.

```sh
.venv/bin/python -m autoeval_api.application_benchmark run \
  --system my-agent --suite SUITE_ID \
  --repository /path/to/clean/agent-checkout --revision FULL_CANDIDATE_COMMIT \
  --model scripted/v1 --mode offline --label 'Offline baseline' \
  --config /path/non-secret-settings.json --output /tmp/baseline.json \
  --allow-local-execution -- node --import tsx scripts/autoeval-adapter.ts
```

The checkout must be clean and match the full candidate SHA before and after
execution. Dependency installation remains the caller's responsibility. Freeze
cases once and hold their suite ID, adapter protocol and model constant across
code revisions. A new process starts per case/repetition; the working directory
is shared and is not an isolated filesystem. Adapters must not write application
state. Use a separate disposable environment for agents that perform mutations.

Execution is shell-free, time-limited and output-limited; process groups are
cleaned up. This is an explicitly authorized local command, not an OS sandbox.
Commands inherit local environment access. Never import untrusted executables,
include keys in argv/settings, or run against real user data without a separately
reviewed data policy. No API endpoint launches commands. Run files are saved
before submission and can be retried through the existing runs endpoint without
rerunning the agent. Only frozen suites can receive results, and the API requires
every case/repetition and every named check exactly once.

## First integration analysis: Lifty

Lifty's `runTrainerAgent` owns bounded read rounds, mandatory tool completion,
reply correction and text rewriting. Its OpenRouter adapter owns transport and
provider retries. The reader owns account-scoped, allowlisted reads; validation
owns proposals; the service and confirmation flow own persistence. AutoEval must
not bypass those boundaries or copy the prompt into a substitute graph.

Initial generic gaps addressed here:

- Application agents needed custom AutoEval plugins or misleading DAG conversion.
- Coding benchmarks coupled frozen tasks to the code being evaluated; application
  input/checks and candidate revisions now have independent identities.
- Whole-JSON equality was too brittle for assistant prose; named field assertions
  focus on structured outcomes and policy invariants.
- Offline fixtures could be mistaken for model evidence; mode is explicit in both
  the invocation and stored result.
- Adapter failures need complete result matrices and content-free diagnostics.

Lifty's first suite should cover direct replies, real retrieval orchestration,
proposal validation, malformed tool batches, read budgets and failure handling.
Start with synthetic fixtures; production conversations, health data, account
credentials, live Supabase writes and automatic training are out of scope.
