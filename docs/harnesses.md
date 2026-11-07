# Coding harness sessions and benchmarks

Connect Claude Code, Codex, Hermes, OpenCode, Pi, or another compatible client
from **Import → Connect a coding harness**. The system appears in the catalog
with its own sessions, reviewed training datasets, and task benchmarks. Its
runtime is explicitly `external_harness`; it cannot run as a LangGraph graph.

## Capture

Run [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) on loopback port
8317 and configure a provider/model there. AutoEval supplies a small recorder
on port 8318 in front of that proxy. This avoids maintaining a provider-routing
fork. Theo's private fork is not a dependency, and this integration does not
claim to reproduce its implementation.

1. Connect the harness in AutoEval.
2. Create a task with a stable key and choose Training, Validation, or Held-out
   benchmark. Group related sessions and repository variants together. The task
   assignment is immutable. Exact duplicate prompts and contexts cannot cross
   partitions within the system; semantic near-duplicates still require review.
3. Save non-secret harness settings, including tools, prompts, budgets and
   reasoning settings, in `harness-settings.json`. Use the actual installed
   harness version or commit as the revision.
4. From the AutoEval checkout, start the recorder:

```sh
.venv/bin/python -m autoeval_api.harness_proxy record \
  --task my-task --revision 'pi@your-version' \
  --config harness-settings.json --capture-content
```

The settings file is hashed, not uploaded. Restart the recorder when switching
tasks. Each recorder invocation has a session ID; each completed request gets a
stable ID in the spool. Concurrent requests are serialized only when appending
the capture. The proxy response is streamed through without waiting for capture
processing. Interrupted/oversize responses are forwarded where possible but
not imported as successful captures; the recorder emits a content-free warning.

5. Point the harness at `http://127.0.0.1:8318/v1` for Chat/Responses, or
   `http://127.0.0.1:8318` for Anthropic. The Connect tab provides configuration
   snippets for each harness. Use the model ID and client key configured in
   CLIProxyAPI. Credentials remain in the harness/proxy configuration.
6. Run a session, then sync:

```sh
.venv/bin/python -m autoeval_api.harness_proxy sync \
  --system my-agent --file .autoeval/captures.jsonl
```

Sync retries are idempotent by system/request ID and reject conflicting content.
It stops at the first invalid row and retains the spool for retry. GET models
and POST Chat, Responses, and Messages HTTP endpoints are supported. WebSockets,
provider-specific endpoints, Gemini protocol, and remote upstreams are not.
Configure a compatible HTTP provider in the harness. Live compatibility with
particular CLI releases still needs validation using your configured provider.

Wire requests/responses are stored as allowlisted JSON with configuration and
model provenance. SSE chunks are assembled into one response, including function
arguments and reported usage. Missing usage or price stays null, not zero.
Tokens mean provider-reported counts, not tokenizer IDs. Cache details remain
in the response usage object. Header credentials, metadata, and hidden reasoning
are excluded. Common secret patterns are redacted, but arbitrary source content
can contain secrets or personal data. Content recording requires explicit opt-in;
review it before approval or export. The local spool uses mode 0600, a 100 MB
limit, and 2 MB request/response limits. Sync and rotate spools yourself. Captures
in the local database are retained; a retention/deletion UI is not included.

## Training

Inspect each capture and approve only correct, useful responses. Pending,
rejected, incomplete, multimodal, and benchmark examples cannot train. Responses
requests using `previous_response_id` resolve their recorded parent chain within
the same session and task. Missing, ambiguous, cyclic or oversized history blocks
approval rather than treating a fragment as a complete conversation.
Tool results must match prior calls in the captured context.

Create a training dataset after approving at least one training task and one
separate validation task. Export freezes an immutable dataset with capture hashes,
task hashes, messages, tools, and the reviewed assistant target. Duplicate contexts
are deduplicated, while conflicting targets and split overlaps fail. Use several
unrelated tasks in practice. Partition assignments apply to whole tasks/sessions,
not random turns, so a later turn cannot leak into a validation split.

Download `train.jsonl` and `valid.jsonl`, or select the resulting dataset in
**Custom models**. Harness training preserves captured instructions instead of
replacing them with the generic JSON training instruction. The existing MLX
worker masks the context and trains on the final assistant response. Its pinned
0.30.7 chat dataset passes both messages and tools to the model's chat template.
Choose a model whose template supports the tools/roles in your data. Local MLX
training requires Apple Silicon; GPU/cloud training is not added by this change.
External trainers can consume the exported JSONL.

Load the resulting adapted/fused model in a compatible serving runtime and
configure that endpoint in CLIProxyAPI or the harness. Select its model ID for
the next benchmark. Exporting examples or creating a recipe does not mean a model
has been trained or deployed. Rejected captures cannot start new training, while
already trained artifacts and downloaded exports require separate disposal.

## Hill climbing

A transcript cannot establish that a different model would complete the task.
The next response changes tool calls, filesystem state, and later context.
This release scores actual external harness runs on frozen tasks, not replayed
transcript imitation. It does not offer a next-response replay leaderboard.

Create held-out tasks with a full Git commit SHA, prompt and verification command
as an argument list. Freeze them with a fixed repetition count. Every candidate
must return every task/repetition exactly once. Errors/timeouts count as failures;
missing cases reject the submission. The primary score is the fraction whose
verification command exits zero. This is externally reported evidence; AutoEval
does not attest that imported results came from a trusted runner.

Run a candidate from a local AutoEval checkout:

```sh
.venv/bin/python -m autoeval_api.harness_benchmark \
  --system my-agent --suite '<frozen-suite-id>' \
  --repository /path/to/trusted/repository --model '<model-id>' \
  --revision '<harness-version>' --label 'Baseline' \
  --config harness-settings.json --allow-local-execution \
  -- your-harness --model '{model}'
```

Use a separate benchmark configuration pointed directly at CLIProxyAPI on port
8317. Do not send benchmark attempts through a recorder assigned to a training
task. If capturing benchmark trajectories, scope a separate recorder to the
correct benchmark task for each attempt. Task labels are caller-supplied; AutoEval
cannot infer whether a mislabeled session actually attempted a held-out task.

Replace the final command with your harness's noninteractive stdin mode. The
runner feeds the task prompt on stdin, replaces `{model}` in argv, and uses no
shell. It clones the local repository into a fresh temporary directory per
attempt, checks out the frozen commit, runs the harness, then the frozen test
command. Provision dependencies through a trusted wrapper if the task needs
more than the checked-out files. The source checkout is preserved. Harness and
test subprocesses have a timeout and output limit; the process group is cleaned
up. A fresh checkout is not a security sandbox: run only trusted commands, and
use your own container/VM boundary for untrusted repositories or harness tools.
Keep independent verification scripts outside files the agent can modify.

Results pin the suite hash, model label, harness revision, command/settings hash,
per-case status, verification output hash, and elapsed time. Unknown tokens and
costs stay unknown. Model labels on submitted runs are declarations; use recorded
resolved model IDs to audit actual routing. The runner saves a result file before
submission so an upload can be retried from the UI without rerunning tasks.

Use the first run as a baseline, change one factor at a time, and compare only
runs from the same frozen suite. The UI reports pass-rate deltas in percentage
points. Repeat stochastic runs; small deltas on small samples are not evidence
of improvement. After tuning on a benchmark repeatedly, create a new untouched
holdout for a final check. Keep final holdouts out of training and prompt tuning.

An LLM judge is not enabled in this version. If added, pin the judge model,
rubric and prompt version, hide candidate identity, randomize presentation,
record ties and judgments, and calibrate against human labels. Treat its score
as secondary to executable tests; do not use it to overwrite test failures.

## Contracts and validation

`harness_schemas.py` defines versioned captures, immutable tasks/suites, and run
results. Migration 13 adds tables for tasks, captures, suites and runs. Routes
under `/api/harnesses` delegate to `services/harnesses.py`. `harness_proxy.py`
handles wire capture; `harness_benchmark.py` is an explicitly invoked local runner.

Tests use synthetic payloads, mock upstream transports and temporary Git
repositories. They exercise streaming reconstruction, tool linkage, retry
conflicts, split leakage, scoped access, native training export, complete trial
matrices, fresh checkout execution, and failures. No provider subscriptions,
real coding sessions, or live training runs are used in CI.

Configuration references:

- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
- [Pi compatible endpoints](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md)
- [OpenCode providers](https://opencode.ai/docs/providers/)
- [Claude Code LLM gateway](https://code.claude.com/docs/en/llm-gateway)
- [Codex configuration](https://developers.openai.com/codex/config-reference)
- [Hermes provider setup](https://github.com/NousResearch/hermes-agent)
- [MLX 0.30.7 chat datasets](https://github.com/ml-explore/mlx-lm/blob/v0.30.7/mlx_lm/tuner/datasets.py)
