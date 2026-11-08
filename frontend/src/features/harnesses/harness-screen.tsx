"use client";
import Link from "next/link";
import { useState } from "react";
import { Select } from "@/components/select";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingState } from "@/components/states";
import { useApiResource } from "@/lib/use-api-resource";
import { useCatalog } from "@/lib/use-catalog";
import {
  harnessApi,
  type Capture,
  type Run,
  type Task,
  type TrainingExport,
} from "./harness-api";
import { connectionGuide } from "./setup";

function download(name: string, value: string) {
  const url = URL.createObjectURL(
    new Blob([value], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
function Code({ children }: { children: string }) {
  return (
    <pre className="mono overflow-x-auto rounded-2xl bg-[var(--card-inset)] p-4 text-xs whitespace-pre-wrap break-words">
      {children}
    </pre>
  );
}

export function HarnessScreen({ systemKey }: { systemKey: string }) {
  const resource = useApiResource(
    () => harnessApi.workspace(systemKey),
    [systemKey],
  );
  const catalog = useCatalog();
  const [tab, setTab] = useState("Connect");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Capture | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [taskKey, setTaskKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [partition, setPartition] = useState<Task["partition"]>("train");
  const [revision, setRevision] = useState("");
  const [testCommand, setTestCommand] = useState('["python", "-m", "pytest"]');
  const [suiteName, setSuiteName] = useState("Coding benchmark");
  const [repetitions, setRepetitions] = useState(1);
  const [suiteId, setSuiteId] = useState("");
  const [baselineId, setBaselineId] = useState("");
  const [recordingTaskKey, setRecordingTaskKey] = useState("");
  const [runDetail, setRunDetail] = useState<Run | null>(null);
  const [training, setTraining] = useState<TrainingExport | null>(null);
  async function perform(action: () => Promise<unknown>, success = "Saved") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await resource.reload();
      setNotice(success);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }
  if (!resource.data)
    return resource.error ? (
      <ErrorState message={resource.error} retry={resource.reload} />
    ) : (
      <LoadingState />
    );
  const workspace = resource.data;
  const activeSuite = suiteId || String(workspace.suites[0]?.id ?? "");
  const runs = workspace.runs.filter((run) => run.suite_id === activeSuite);
  const baseline = runs.find((run) => run.id === baselineId) ?? runs[0];
  const recordingTasks = workspace.tasks.filter(
    (task) => task.partition !== "benchmark",
  );
  const recordingTask =
    recordingTasks.find((task) => task.key === recordingTaskKey) ??
    recordingTasks[0];
  const captureFile = `.autoeval/${systemKey}/captures.jsonl`;
  return (
    <>
      <PageHeader
        title={workspace.name}
        description="Capture sessions. Review examples. Measure the next version."
      />
      <div className="grid gap-5 p-4 md:p-7">
        <nav aria-label="Harness workflow" className="flex flex-wrap gap-2">
          {["Connect", "Sessions & training", "Benchmark"].map((item) => (
            <button
              className="app-button secondary"
              aria-pressed={tab === item}
              key={item}
              onClick={() => {
                setTab(item);
                if (item === "Benchmark") setPartition("benchmark");
                if (item === "Connect") setPartition("train");
              }}
            >
              {item}
            </button>
          ))}
        </nav>
        {error && (
          <p role="alert" className="text-[var(--danger)]">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {tab === "Connect" && (
          <section className="surface-card grid min-w-0 gap-5 p-6">
            <h2>1. Start your local model proxy</h2>
            <p>
              Install{" "}
              <a
                className="underline"
                href="https://github.com/router-for-me/CLIProxyAPI"
                target="_blank"
                rel="noreferrer"
              >
                CLIProxyAPI
              </a>
              , bind it to 127.0.0.1:8317, configure your provider, and verify a
              model works. Keep provider credentials in the proxy.
            </p>
            <h2>2. Create a task below, then start recording</h2>
            <p className="text-sm text-[var(--text-muted)]">
              Run from the AutoEval checkout. Use a non-secret file containing
              your harness settings and the installed harness version. Restart
              the recorder for each new task. Capture includes prompts, code,
              and tool results. Review sensitive content before approving any
              example.
            </p>
            {recordingTask ? (
              <>
                <label className="grid gap-2">
                  Record sessions for
                  <Select
                    aria-label="Record sessions for"
                    className="app-input"
                    value={recordingTask.key}
                    onChange={(event) => setRecordingTaskKey(event.target.value)}
                  >
                    {recordingTasks.map((task) => (
                      <option key={task.key} value={task.key}>
                        {task.key} ·{" "}
                        {task.partition === "train" ? "Training" : "Validation"}
                      </option>
                    ))}
                  </Select>
                </label>
                <Code>{`.venv/bin/python -m autoeval_api.harness_proxy record \\\n  --task ${recordingTask.key} --revision '<harness-version>' \\\n  --config harness-settings.json --output ${captureFile} --capture-content`}</Code>
              </>
            ) : (
              <p>
                Create a training or validation task below to get its recording
                command.
              </p>
            )}
            <h2>3. Point your harness at the recorder</h2>
            <Code>{connectionGuide(workspace.harness)}</Code>
            <p className="text-sm text-[var(--text-muted)]">
              Merge these settings into your harness configuration. Use the
              proxy model ID and key you configured. Only requests sent to this
              endpoint are captured. Chat, Responses, and Anthropic HTTP
              streaming are supported; WebSocket sessions are not.
            </p>
            <h2>4. Sync and review</h2>
            <Code>{`.venv/bin/python -m autoeval_api.harness_proxy sync \\\n  --system ${systemKey} --file ${captureFile}`}</Code>
            <p className="text-sm text-[var(--text-muted)]">
              Each system has its own capture file. Stop the recorder before
              switching systems or tasks, then start the command for your new
              selection. Sync safely retries the same captures. Missing token
              usage stays unknown. Incomplete responses, image payloads, and Responses
              calls with missing history cannot be approved for training.
            </p>
          </section>
        )}
        {tab !== "Sessions & training" && (
          <form
            className="surface-card grid gap-4 p-6"
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                await harnessApi.post(systemKey, "tasks", {
                  key: taskKey,
                  partition,
                  prompt,
                  repository_revision: revision,
                  test_command:
                    partition === "benchmark" ? JSON.parse(testCommand) : [],
                });
                if (partition !== "benchmark") setRecordingTaskKey(taskKey);
                setTaskKey("");
                setPrompt("");
              }, "Task saved. Its partition and contents are now fixed.");
            }}
          >
            <h2>Add a task</h2>
            <p className="text-sm text-[var(--text-muted)]">
              Keep related sessions in one task. Use separate tasks for
              training, validation, and benchmarks. Never train on benchmark
              answers.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2">
                Task key
                <input
                  className="app-input"
                  required
                  pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}"
                  value={taskKey}
                  onChange={(e) => setTaskKey(e.target.value)}
                />
              </label>
              <label className="grid gap-2">
                Use for
                <Select
                  aria-label="Use for"
                  className="app-input"
                  value={partition}
                  onChange={(e) =>
                    setPartition(e.target.value as Task["partition"])
                  }
                >
                  <option value="train">Training</option>
                  <option value="validation">Validation</option>
                  <option value="benchmark">Held-out benchmark</option>
                </Select>
              </label>
            </div>
            <label className="grid gap-2">
              Task prompt
              <textarea
                className="app-input"
                required
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </label>
            {partition === "benchmark" && (
              <>
                <label className="grid gap-2">
                  Repository commit
                  <input
                    className="app-input mono"
                    required
                    value={revision}
                    onChange={(e) => setRevision(e.target.value)}
                    placeholder="Full Git commit SHA"
                  />
                </label>
                <label className="grid gap-2">
                  Test command as JSON arguments
                  <input
                    className="app-input mono"
                    required
                    value={testCommand}
                    onChange={(e) => setTestCommand(e.target.value)}
                  />
                </label>
              </>
            )}
            <button className="app-button w-fit" disabled={busy}>
              Save task
            </button>
            <ul className="grid gap-2 text-sm">
              {workspace.tasks.map((task) => (
                <li key={task.key}>
                  <code>{task.key}</code> · {task.partition}
                </li>
              ))}
            </ul>
          </form>
        )}
        {tab === "Sessions & training" && (
          <>
            <section className="surface-card grid gap-4 p-6">
              <h2>Review captures</h2>
              <button
                className="app-button secondary w-fit"
                disabled={busy}
                onClick={() => void resource.reload()}
              >
                Refresh captures
              </button>
              <p className="text-sm text-[var(--text-muted)]">
                Approve correct, useful assistant responses after inspecting the
                full context and tool results. Approval does not prove that a
                coding task passed. Showing the latest 500 captures.
              </p>
              {workspace.captures.length === 0 && (
                <p>
                  No captures yet. Complete the connection steps, run your
                  harness, and sync.
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Model</th>
                      <th>Tokens in / out</th>
                      <th>Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workspace.captures.map((capture) => (
                      <tr key={capture.id}>
                        <td>
                          <button
                            className="underline py-3"
                            onClick={() =>
                              void perform(async () => {
                                setSelected(
                                  await harnessApi.capture(
                                    systemKey,
                                    capture.id,
                                  ),
                                );
                                setSelectedId(capture.id);
                              }, "Capture opened")
                            }
                          >
                            {capture.task_key}
                          </button>
                          <div className="text-xs text-[var(--text-muted)]">
                            {capture.partition}
                          </div>
                        </td>
                        <td>{capture.model}</td>
                        <td>
                          {capture.input_tokens ?? "?"} /{" "}
                          {capture.output_tokens ?? "?"}
                        </td>
                        <td>{capture.review}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {selected && (
                <div className="grid min-w-0 gap-3">
                  <h3>Captured conversation</h3>
                  <Code>{JSON.stringify(selected, null, 2)}</Code>
                  <div className="flex gap-3">
                    <button
                      className="app-button"
                      disabled={busy}
                      onClick={() =>
                        void perform(
                          () =>
                            harnessApi.post(
                              systemKey,
                              `captures/${selectedId}/review`,
                              { decision: "approved" },
                            ),
                          "Capture approved",
                        )
                      }
                    >
                      Approve for training
                    </button>
                    <button
                      className="app-button secondary"
                      disabled={busy}
                      onClick={() =>
                        void perform(
                          () =>
                            harnessApi.post(
                              systemKey,
                              `captures/${selectedId}/review`,
                              { decision: "rejected" },
                            ),
                          "Capture rejected",
                        )
                      }
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </section>
            <section className="surface-card grid gap-4 p-6">
              <h2>Create a training dataset</h2>
              <p>
                Freeze approved training and validation tasks into a versioned
                dataset. Conversation roles and tool schemas are preserved.
                Benchmark tasks are excluded.
              </p>
              <button
                className="app-button w-fit"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    setTraining(
                      await harnessApi.post<TrainingExport>(
                        systemKey,
                        "training-export",
                      ),
                    );
                    await catalog.reload();
                  }, "Training dataset finalized")
                }
              >
                Create training dataset
              </button>
              {training && (
                <>
                  <p>
                    {training.train.length} training examples ·{" "}
                    {training.validation.length} validation examples
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      className="app-button secondary"
                      onClick={() =>
                        download(
                          "train.jsonl",
                          training.train
                            .map((row) => JSON.stringify(row))
                            .join("\n") + "\n",
                        )
                      }
                    >
                      Download train.jsonl
                    </button>
                    <button
                      className="app-button secondary"
                      onClick={() =>
                        download(
                          "valid.jsonl",
                          training.validation
                            .map((row) => JSON.stringify(row))
                            .join("\n") + "\n",
                        )
                      }
                    >
                      Download valid.jsonl
                    </button>
                    <Link className="app-button" href="/custom-models">
                      Create custom model
                    </Link>
                  </div>
                  <p className="text-sm text-[var(--text-muted)]">
                    Select “{workspace.name} reviewed sessions” in Custom
                    models. Local training requires Apple Silicon. You can also
                    use the JSONL files with an external trainer, serve the
                    trained model through your proxy, and benchmark it here.
                  </p>
                </>
              )}
            </section>
          </>
        )}
        {tab === "Benchmark" && (
          <>
            <section className="surface-card grid gap-4 p-6">
              <h2>Freeze a benchmark</h2>
              <p>
                Every candidate runs the same held-out tasks, repository
                commits, tests, and repetition count. Change one model or
                harness setting at a time.
              </p>
              <label className="grid gap-2">
                Benchmark name
                <input
                  className="app-input"
                  value={suiteName}
                  onChange={(e) => setSuiteName(e.target.value)}
                />
              </label>
              <label className="grid gap-2">
                Repetitions per task
                <input
                  className="app-input"
                  type="number"
                  min={1}
                  max={10}
                  value={repetitions}
                  onChange={(e) => setRepetitions(Number(e.target.value))}
                />
              </label>
              <button
                className="app-button w-fit"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const result = await harnessApi.post<{ id: string }>(
                      systemKey,
                      "suites",
                      {
                        name: suiteName,
                        repetitions,
                        task_keys: workspace.tasks
                          .filter((task) => task.partition === "benchmark")
                          .map((task) => task.key),
                      },
                    );
                    setSuiteId(result.id);
                    setBaselineId("");
                    setRunDetail(null);
                  }, "Benchmark frozen")
                }
              >
                Freeze all benchmark tasks
              </button>
            </section>
            {workspace.suites.length > 0 && (
              <section className="surface-card grid min-w-0 gap-4 p-6">
                <h2>Compare candidates</h2>
                <label className="grid gap-2">
                  Benchmark
                  <Select
                    aria-label="Benchmark"
                    className="app-input"
                    value={activeSuite}
                    onChange={(e) => {
                      setSuiteId(e.target.value);
                      setBaselineId("");
                      setRunDetail(null);
                    }}
                  >
                    {workspace.suites.map((suite) => (
                      <option key={String(suite.id)} value={String(suite.id)}>
                        {String(suite.name)} ·{" "}
                        {String(suite.content_hash).slice(0, 8)}
                      </option>
                    ))}
                  </Select>
                </label>
                {runs.length > 0 && (
                  <label className="grid gap-2">
                    Compare against
                    <Select
                      aria-label="Compare against"
                      className="app-input"
                      value={baseline?.id ?? ""}
                      onChange={(event) => setBaselineId(event.target.value)}
                    >
                      {runs.map((run) => (
                        <option key={run.id} value={run.id}>
                          {run.label} · {run.model} ·{" "}
                          {run.configuration_hash.slice(0, 8)}
                        </option>
                      ))}
                    </Select>
                  </label>
                )}
                <p className="text-sm text-[var(--text-muted)]">
                  Use the local runner on a trusted repository. It creates a
                  fresh checkout per attempt and feeds the task prompt to your
                  command on stdin. Commands run as your user. Keep independent
                  verification tests outside files the agent can edit.
                </p>
                <Code>{`.venv/bin/python -m autoeval_api.harness_benchmark \\\n  --system ${systemKey} --suite ${activeSuite} \\\n  --repository /path/to/repo --model '<candidate-model>' \\\n  --revision '<harness-version>' --label 'Baseline' --config harness-settings.json \\\n  --allow-local-execution -- your-harness --model '{model}'`}</Code>
                <p className="text-sm text-[var(--text-muted)]">
                  Use a separate benchmark configuration pointed directly at
                  CLIProxyAPI on port 8317, or a recorder scoped to each
                  held-out task. Do not use a training-task recorder. Replace
                  the command with your harness’s noninteractive stdin mode. Use
                  the same command and limits for model comparisons. Results are
                  reported by your local runner. A passing score means its test
                  command exited zero, not an independently verified correctness
                  claim.
                </p>
                <label className="grid gap-2">
                  Import saved run results
                  <input
                    type="file"
                    accept=".json"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file)
                        void perform(async () => {
                          if (file.size > 2_000_000)
                            throw new Error("Results file exceeds 2 MB");
                          await harnessApi.post(
                            systemKey,
                            "runs",
                            JSON.parse(await file.text()),
                          );
                        }, "Run imported");
                    }}
                  />
                </label>
                <button
                  className="app-button secondary w-fit"
                  onClick={() => void resource.reload()}
                >
                  Refresh results
                </button>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm [&_td]:pr-4 [&_th]:pr-4">
                    <thead>
                      <tr>
                        <th>Candidate</th>
                        <th>Passed</th>
                        <th>Change vs {baseline?.label ?? "baseline"}</th>
                        <th>Mean time</th>
                        <th>Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((run) => (
                        <tr key={run.id}>
                          <td className="py-3">
                            <button
                              className="underline"
                              onClick={() =>
                                void perform(
                                  async () =>
                                    setRunDetail(
                                      await harnessApi.run(systemKey, run.id),
                                    ),
                                  "Run details opened",
                                )
                              }
                            >
                              {run.label}
                            </button>
                            <div className="text-xs text-[var(--text-muted)]">
                              {run.model} · {run.harness_revision} ·{" "}
                              {run.configuration_hash.slice(0, 8)}
                            </div>
                          </td>
                          <td>
                            {run.passed}/{run.total} ·{" "}
                            {(run.pass_rate * 100).toFixed(1)}%
                          </td>
                          <td>
                            {(
                              (run.pass_rate - (baseline?.pass_rate ?? 0)) *
                              100
                            ).toFixed(1)}{" "}
                            pp
                          </td>
                          <td>{(run.mean_latency_ms / 1000).toFixed(1)} s</td>
                          <td>
                            {run.cost_usd === null
                              ? "Unknown"
                              : `$${run.cost_usd.toFixed(4)}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {runDetail && (
                  <section className="grid gap-3">
                    <h3>{runDetail.label} attempts</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr>
                            <th>Task</th>
                            <th>Attempt</th>
                            <th>Outcome</th>
                            <th>Test exit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {runDetail.results.map((result) => (
                            <tr key={`${result.task_key}:${result.repetition}`}>
                              <td>{result.task_key}</td>
                              <td>{result.repetition}</td>
                              <td>{result.status}</td>
                              <td>{result.test_exit_code ?? "Not run"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button
                      className="app-button secondary w-fit"
                      onClick={() =>
                        download(
                          "benchmark-result.json",
                          JSON.stringify(runDetail, null, 2),
                        )
                      }
                    >
                      Download evidence
                    </button>
                  </section>
                )}
                <p className="text-sm text-[var(--text-muted)]">
                  Errors and timeouts count as failures. Small score differences
                  need more tasks and repeated runs. Use a fresh holdout after
                  tuning repeatedly on a benchmark. Model-judge scoring is not
                  enabled; executable checks are the primary score.
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
