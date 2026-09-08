"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  FileCodeIcon,
  FolderOpenIcon,
  GithubLogoIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRef, useState, type DragEvent } from "react";
import { PageHeader } from "@/components/page-header";
import { AgentGraph, isGraphDefinition } from "@/features/systems/agent-graph";
import {
  importApi,
  type ImportPreview,
  type ImportResult,
} from "@/features/systems/import-api";
import {
  findManifestFiles,
  manifestsFromDrop,
  readManifest,
  type ManifestFile,
} from "@/features/systems/import-files";
import { starterManifest } from "@/features/systems/import-starter";
import { systemPath } from "@/features/systems/system-path";
import { useCatalog } from "@/lib/use-catalog";
import styles from "./onboarding.module.css";

type SourceMode = "folder" | "github" | "json";

export function ImportScreen({ systemKey }: { systemKey?: string }) {
  const { reload } = useCatalog();
  const [mode, setMode] = useState<SourceMode>("folder");
  const [files, setFiles] = useState<ManifestFile[]>([]);
  const [githubUrl, setGithubUrl] = useState("");
  const [json, setJson] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const generation = useRef(0);

  async function inspect(load: () => Promise<ImportPreview>, label: string) {
    const request = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const next = await load();
      if (request !== generation.current) return;
      if (systemKey && next.manifest.system.key !== systemKey) {
        throw new Error(
          `This manifest belongs to ${next.manifest.system.key}. Use the system key ${systemKey} to import a version here.`,
        );
      }
      setPreview(next);
      setSourceLabel(label);
      requestAnimationFrame(() => reviewHeading.current?.focus());
    } catch (caught) {
      if (request === generation.current) setError(message(caught));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }

  async function inspectFile(item: ManifestFile) {
    await inspect(
      async () => importApi.inspectManifest(await readManifest(item.file)),
      item.path,
    );
  }

  async function chooseFiles(candidates: ManifestFile[]) {
    setFiles(candidates);
    setError(null);
    if (!candidates.length) {
      setError(
        "No autoeval.json found. Follow the import guide to describe your graph, then select this folder again.",
      );
    } else if (candidates.length === 1) {
      await inspectFile(candidates[0]);
    }
  }

  async function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const candidates = await manifestsFromDrop(event.dataTransfer);
      await chooseFiles(candidates);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await importApi.commit({
        manifest: preview.manifest,
        expected_digest: preview.digest,
        expected_system_key: preview.manifest.system.key,
        expected_system_id: preview.existing_system_id,
        expected_graph_version: preview.next_graph_version,
        expected_prompt_version: preview.next_prompt_version,
        source:
          preview.source.kind === "github"
            ? preview.source
            : { ...preview.source, display_path: sourceLabel.slice(0, 500) },
      });
      setResult(created);
      await reload();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  function back() {
    ++generation.current;
    setPreview(null);
    setError(null);
    setBusy(false);
  }

  return (
    <>
      <PageHeader
        title={systemKey ? "Import a version" : "Import an agent system"}
        description={
          systemKey
            ? `Add a version to ${systemKey}. Saved versions stay unchanged.`
            : "Bring a graph from your folder or GitHub repository."
        }
        // action={
        //   <Link className="app-button secondary" href="/guide">
        //     Import guide <ArrowRightIcon size={14} />
        //   </Link>
        // }
      />
      <div className={styles.workspace}>
        <nav className={styles.stepRail} aria-label="Import progress">
          {["Choose source", "Review graph", "Ready to run"].map(
            (label, index) => {
              const current = result ? 2 : preview ? 1 : 0;
              return (
                <div
                  key={label}
                  aria-current={index === current ? "step" : undefined}
                  data-complete={index < current}
                >
                  <span className={styles.stepNumber}>
                    {index < current ? <CheckIcon size={13} /> : index + 1}
                  </span>
                  {label}
                </div>
              );
            },
          )}
          <p>
            One manifest.
            <br />A version you can reproduce.
          </p>
        </nav>
        <section className={styles.mainPanel} aria-busy={busy}>
          {result && preview ? (
            <div className={styles.success}>
              <CheckIcon size={28} className={styles.successMark} />
              <h2>{preview.manifest.system.name} is ready</h2>
              <p>
                Graph <span className="mono">v{result.graph_version}</span> and
                prompt <span className="mono">v{result.prompt_version}</span>{" "}
                are saved. Select a model and try your first request.
              </p>
              <div className={styles.actions}>
                <Link
                  href={`${systemPath(preview.manifest.system.key, "run")}?${new URLSearchParams({ graphVersion: result.graph_version_id, promptVersion: result.prompt_version_id })}`}
                  className="app-button"
                >
                  Run this agent <ArrowRightIcon size={14} />
                </Link>
                <Link
                  href={`${systemPath(preview.manifest.system.key, "artifacts")}?${new URLSearchParams({ graphVersion: result.graph_version_id, promptVersion: result.prompt_version_id })}`}
                  className="app-button secondary"
                >
                  Open graph editor
                </Link>
              </div>
              <Link href="/guide#local-models" className={styles.inlineLink}>
                Use a local model with LM Studio
              </Link>
            </div>
          ) : preview ? (
            <>
              <div className={styles.panelHeader}>
                <div>
                  <h2 ref={reviewHeading} tabIndex={-1}>
                    {preview.manifest.system.name}
                  </h2>
                  <p>{preview.manifest.system.description}</p>
                </div>
                <span className={styles.versionBadge}>
                  {preview.creates_system ? "New system" : "New version"}
                </span>
              </div>
              <div className={styles.receipt}>
                <span>
                  <FileCodeIcon size={14} />
                  <span className="mono">{sourceLabel}</span>
                </span>
                <span className="mono">
                  {preview.counts.nodes} nodes · {preview.counts.llm_nodes}{" "}
                  model calls
                </span>
              </div>
              {isGraphDefinition(preview.manifest.graph) ? (
                <AgentGraph definition={preview.manifest.graph} />
              ) : null}
              <div className={styles.reviewDetails}>
                <div>
                  <span>System key</span>
                  <code>{preview.manifest.system.key}</code>
                </div>
                <div>
                  <span>
                    {preview.graph_version_created
                      ? "New graph"
                      : "Reused graph"}
                  </span>
                  <code>v{preview.target_graph_version}</code>
                </div>
                <div>
                  <span>
                    {preview.prompt_version_created
                      ? "New prompt"
                      : "Reused prompt"}
                  </span>
                  <code>v{preview.target_prompt_version}</code>
                </div>
                <div>
                  <span>Manifest hash</span>
                  <code title={preview.digest}>
                    {preview.digest.slice(0, 16)}
                  </code>
                </div>
              </div>
              <details className={styles.details}>
                <summary>Prompt and example input</summary>
                <p className={styles.prompt}>
                  {preview.manifest.prompt.content}
                </p>
                <pre>
                  {JSON.stringify(
                    preview.manifest.system.input_template ?? {},
                    null,
                    2,
                  )}
                </pre>
              </details>
              <details className={styles.details}>
                <summary>Review complete manifest</summary>
                <pre>{JSON.stringify(preview.manifest, null, 2)}</pre>
              </details>
              {preview.warnings.length ? (
                <ul className={styles.notices}>
                  {preview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              <div className={styles.actions}>
                <button
                  type="button"
                  className="app-button secondary"
                  onClick={back}
                  disabled={busy}
                >
                  <ArrowLeftIcon size={14} />
                  Change source
                </button>
                <button
                  type="button"
                  className="app-button"
                  onClick={commit}
                  disabled={busy || !preview.compatibility.runnable}
                >
                  {busy
                    ? "Importing..."
                    : preview.creates_system
                      ? "Import system"
                      : "Import version"}
                  <ArrowRightIcon size={14} />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={styles.panelHeader}>
                <div>
                  <h2>Where does your agent live?</h2>
                  <p>
                    AutoEval reads <code>autoeval.json</code> to validate its
                    graph and registered handlers.
                  </p>
                </div>
              </div>
              <div
                className={styles.sourceTabs}
                role="group"
                aria-label="Import source"
              >
                {(
                  [
                    ["folder", "Local folder", FolderOpenIcon],
                    ["github", "GitHub", GithubLogoIcon],
                    ["json", "Paste manifest", FileCodeIcon],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    disabled={busy}
                    onClick={() => {
                      setMode(value);
                      setError(null);
                    }}
                  >
                    <Icon size={16} />
                    {label}
                  </button>
                ))}
              </div>
              {mode === "folder" ? (
                <>
                  <div
                    className={styles.dropzone}
                    data-dragging={dragging}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={(event) => {
                      if (
                        !event.currentTarget.contains(
                          event.relatedTarget as Node,
                        )
                      )
                        setDragging(false);
                    }}
                    onDrop={drop}
                  >
                    <UploadSimpleIcon size={30} aria-hidden="true" />
                    <h3>
                      {busy
                        ? "Reading manifest..."
                        : "Drop your agent folder here"}
                    </h3>
                    <p>
                      Only the manifest is read. Source files stay on your
                      computer.
                    </p>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className="app-button"
                        disabled={busy}
                        onClick={() => folderInput.current?.click()}
                      >
                        Choose folder
                      </button>
                      <button
                        type="button"
                        className="app-button secondary"
                        disabled={busy}
                        onClick={() => fileInput.current?.click()}
                      >
                        Choose autoeval.json
                      </button>
                    </div>
                    <input
                      ref={folderInput}
                      type="file"
                      aria-label="Agent folder"
                      hidden
                      {...{ webkitdirectory: "", directory: "" }}
                      multiple
                      onChange={(event) => {
                        try {
                          void chooseFiles(
                            findManifestFiles(
                              Array.from(event.target.files ?? []),
                            ),
                          );
                        } catch (caught) {
                          setError(message(caught));
                        }
                        event.target.value = "";
                      }}
                    />
                    <input
                      ref={fileInput}
                      type="file"
                      aria-label="Manifest file"
                      hidden
                      accept=".json,application/json"
                      onChange={(event) => {
                        try {
                          void chooseFiles(
                            findManifestFiles(
                              Array.from(event.target.files ?? []),
                            ),
                          );
                        } catch (caught) {
                          setError(message(caught));
                        }
                        event.target.value = "";
                      }}
                    />
                  </div>
                  {files.length > 1 ? (
                    <div className={styles.fileChoices}>
                      <h3>Choose a manifest</h3>
                      {files.map((item) => (
                        <button
                          type="button"
                          className="data-row"
                          key={item.path}
                          disabled={busy}
                          onClick={() => inspectFile(item)}
                        >
                          <FileCodeIcon size={14} />
                          <span className="mono">{item.path}</span>
                          <ArrowRightIcon size={14} />
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : mode === "github" ? (
                <form
                  className={styles.sourceForm}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void inspect(
                      () => importApi.inspectGithub(githubUrl.trim()),
                      githubUrl.trim(),
                    );
                  }}
                >
                  <label className="field">
                    <span>GitHub repository or manifest link</span>
                    <input
                      className="app-input mono"
                      type="url"
                      required
                      value={githubUrl}
                      onChange={(event) => setGithubUrl(event.target.value)}
                      placeholder="https://github.com/owner/agent"
                      disabled={busy}
                    />
                  </label>
                  <p>
                    Use a public repository, subfolder, or{" "}
                    <code>autoeval.json</code> link. For a private repository,
                    clone it and choose the local folder.
                  </p>
                  <button
                    className="app-button"
                    type="submit"
                    disabled={busy || !githubUrl.trim()}
                  >
                    {busy ? "Inspecting..." : "Review repository"}
                    <ArrowRightIcon size={14} />
                  </button>
                </form>
              ) : (
                <form
                  className={styles.sourceForm}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void inspect(async () => {
                      let value: unknown;
                      try {
                        value = JSON.parse(json);
                      } catch {
                        throw new Error(
                          "The manifest contains invalid JSON. Check commas, quotes, and brackets.",
                        );
                      }
                      return importApi.inspectManifest(value);
                    }, "Pasted autoeval.json");
                  }}
                >
                  <label className="field">
                    <span>autoeval.json</span>
                    <textarea
                      className="app-textarea mono"
                      value={json}
                      onChange={(event) => setJson(event.target.value)}
                      rows={12}
                      spellCheck={false}
                      disabled={busy}
                    />
                  </label>
                  <button
                    className="app-button"
                    disabled={busy || !json.trim()}
                  >
                    {busy ? "Validating..." : "Review manifest"}
                    <ArrowRightIcon size={14} />
                  </button>
                </form>
              )}
              <div className={styles.helpRow}>
                <div>
                  <h3>No manifest yet?</h3>
                  <p>
                    Follow the guide, or give its adapter brief to your
                    coding agent.
                  </p>
                </div>
                <Link href="/guide" className={styles.inlineLink}>
                  Import guide <ArrowRightIcon size={14} />
                </Link>
              </div>
              {!systemKey ? (
                <button
                  type="button"
                  className={styles.inlineLink}
                  disabled={busy}
                  onClick={() =>
                    inspect(
                      () => importApi.inspectManifest(starterManifest),
                      "Support summary starter",
                    )
                  }
                >
                  Try an example <ArrowRightIcon size={14} />
                </button>
              ) : null}
            </>
          )}
          {error ? (
            <div role="alert" className={styles.error}>
              <p>{error}</p>
              {error.includes("No autoeval.json") ? (
                <Link href="/guide">Open the import guide</Link>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Import failed. Try again.";
}
