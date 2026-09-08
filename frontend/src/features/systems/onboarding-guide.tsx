"use client";

import {
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  DownloadSimpleIcon,
  FileCodeIcon,
  FolderIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  codingAgentBrief,
  downloadText,
  starterJson,
} from "@/features/systems/import-starter";
import { useCatalog } from "@/lib/use-catalog";
import styles from "./onboarding.module.css";

const guideSteps = [
  {
    title: "Describe your system",
    detail: "One file beside your agent code.",
    filename: "support-summary / autoeval.json",
  },
  {
    title: "Map the behavior",
    detail: "Name the steps, their handlers, and their edges.",
    filename: "graph / read → summarize → return",
  },
  {
    title: "Review and import",
    detail: "Validate the graph before saving a version.",
    filename: "import / review",
  },
  {
    title: "Run, then iterate",
    detail: "Use real traces to build a test dataset.",
    filename: "support-summary / versions",
  },
];

const localSetup = `ENABLE_LM_STUDIO=true
LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1
LM_STUDIO_MODELS=your-loaded-model-id`;

export function OnboardingGuide() {
  const [step, setStep] = useState(0);
  const reduceMotion = useReducedMotion();
  const catalog = useCatalog();
  const localModels =
    catalog.data?.models.filter((model) => model.provider === "lmstudio") ?? [];
  return (
    <>
      <PageHeader
        title="Import guide"
        action={
          <Link href="/import" className="app-button">
            Import a system <ArrowRightIcon size={14} />
          </Link>
        }
      />
      <div className={styles.guide}>
        <div className={styles.guideIntro}>
          <h2>
            Prepare to import your agent into AutoEval
          </h2>
          <p>
            Describe the graph, connect its handlers, and bring it into
            AutoEval. Keep the same system key as your agent evolves.
          </p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className="app-button secondary"
            onClick={() => downloadText("autoeval.json", starterJson)}
          >
            <DownloadSimpleIcon size={14} />
            Download starter
          </button>
          <a href="#custom-code" className={styles.inlineLink}>
            Adapt an existing codebase <ArrowRightIcon size={14} />
          </a>
          <a href="#local-models" className={styles.inlineLink}>
            Use LM Studio <ArrowRightIcon size={14} />
          </a>
        </div>
        <div className={styles.walkthrough}>
          <nav className={styles.guideSteps} aria-label="Setup walkthrough">
            {guideSteps.map((item, index) => (
              <button
                type="button"
                key={item.title}
                aria-pressed={step === index}
                aria-controls="guide-scene"
                onClick={() => setStep(index)}
              >
                <span>0{index + 1}</span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
              </button>
            ))}
          </nav>
          <div
            className={styles.guideScene}
            id="guide-scene"
            role="region"
            aria-label={guideSteps[step].title}
          >
            <div className={styles.sceneChrome}>
              <span>{guideSteps[step].filename}</span>
              <span>{step + 1} / 4</span>
            </div>
            <motion.div
              key={step}
              className={styles.sceneBody}
              initial={
                reduceMotion
                  ? false
                  : { opacity: 0.3, y: 6, filter: "blur(3px)" }
              }
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{
                duration: reduceMotion ? 0 : 0.28,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              {step === 0 ? (
                <>
                  <div className={styles.fileTree}>
                    <span>
                      <FolderIcon size={16} />
                      support-summary/
                    </span>
                    <span>
                      <FileCodeIcon size={14} />
                      agent.py
                    </span>
                    <span>
                      <FileCodeIcon size={14} />
                      tests/
                    </span>
                    <span>
                      <FileCodeIcon size={14} />
                      autoeval.json
                    </span>
                  </div>
                  <p>
                    The manifest holds a stable key, a sample input, a graph,
                    and its prompt. The import reads this file.
                  </p>
                </>
              ) : step === 1 ? (
                <>
                  <div
                    className={styles.miniGraph}
                    aria-label="Read request, then summarize with a model, then return the summary"
                  >
                    <div className={styles.miniNode}>
                      <small>deterministic</small>
                      <strong>Read request</strong>
                    </div>
                    <ArrowRightIcon size={14} />
                    <div className={styles.miniNode} data-kind="llm">
                      <small>model</small>
                      <strong>Summarize</strong>
                    </div>
                    <ArrowRightIcon size={14} />
                    <div className={styles.miniNode}>
                      <small>deterministic</small>
                      <strong>Return summary</strong>
                    </div>
                  </div>
                  <p>
                    Every node names a handler. Edges describe execution order.
                    Choose a model when you run, so the same graph can compare
                    local and hosted inference.
                  </p>
                </>
              ) : step === 2 ? (
                <>
                  <h3>Support summary</h3>
                  <div>
                    <div className={styles.pinRow}>
                      <CheckIcon size={15} />
                      <span>Graph and handlers valid</span>
                      <code>3 nodes</code>
                    </div>
                    <div className={styles.pinRow}>
                      <CheckIcon size={15} />
                      <span>Prompt captured</span>
                      <code>v1</code>
                    </div>
                    <div className={styles.pinRow}>
                      <CheckIcon size={15} />
                      <span>Draft dataset created on import</span>
                      <code>0 examples</code>
                    </div>
                  </div>
                  <p>
                    Preview makes no changes. Import saves the validated
                    manifest and immutable versions together.
                  </p>
                </>
              ) : (
                <>
                  <h3>Keep the evidence. Change the agent.</h3>
                  <div>
                    <div className={styles.pinRow}>
                      <span>Run a request</span>
                      <code>graph v1 · prompt v1</code>
                    </div>
                    <div className={styles.pinRow}>
                      <span>Save a trace to the dataset</span>
                      <code>review → finalize</code>
                    </div>
                    <div className={styles.pinRow}>
                      <span>Edit or import the next graph</span>
                      <code>graph v2 · prompt v1</code>
                    </div>
                  </div>
                  <p>
                    Old traces still point to v1. Run the same finalized dataset
                    against v2 to compare the change.
                  </p>
                </>
              )}
            </motion.div>
          </div>
        </div>
        <section className={styles.guideSection} id="manifest">
          <h2>The contract</h2>
          <p>
            The starter runs a support-summary graph using three built-in
            handlers. Change its name, key, input, and prompt to make your own.
            The complete JSON remains available in the graph editor.
          </p>
          <table className={styles.contractTable}>
            <thead>
              <tr>
                <th>Field</th>
                <th>What belongs here</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>schema_version</code>
                </td>
                <td>
                  <code>1</code>. The manifest format, independent of your graph
                  version.
                </td>
              </tr>
              <tr>
                <td>
                  <code>system</code>
                </td>
                <td>
                  A stable <code>key</code>, <code>name</code>, optional
                  description and JSON <code>input_template</code>.
                </td>
              </tr>
              <tr>
                <td>
                  <code>graph.nodes</code>
                </td>
                <td>
                  Each step&apos;s ID, label, kind, and registered handler.
                  Model nodes can add a task and response schema.
                </td>
              </tr>
              <tr>
                <td>
                  <code>graph.edges</code>
                </td>
                <td>
                  Source and target node IDs. The graph must be reachable and
                  acyclic.
                </td>
              </tr>
              <tr>
                <td>
                  <code>graph.entry_point</code>
                  <br />
                  <code>graph.output_node</code>
                </td>
                <td>
                  The first step and the final output step. The output handler
                  writes the result.
                </td>
              </tr>
              <tr>
                <td>
                  <code>prompt.content</code>
                </td>
                <td>
                  The primary system prompt, stored as its own immutable
                  version.
                </td>
              </tr>
            </tbody>
          </table>
          <details className={styles.details}>
            <summary>View the complete starter manifest</summary>
            <CodeBlock title="autoeval.json" code={starterJson} />
          </details>
          <p>
            Use the same key when importing a revision. AutoEval creates a
            version for each changed graph or prompt, reuses unchanged versions,
            and rejects a duplicate import. In Artifacts, choose Edit graph to
            change nodes and connections, then Save new version.
          </p>
        </section>
        <section className={styles.guideSection} id="custom-code">
          <h2>Bring an existing codebase</h2>
          <p>
            Start by mapping the behavior. A manifest can run directly when its
            steps use registered handlers. Custom tools, retrieval, loops, and
            framework-specific state need an explicit adapter. Dropping a folder
            does not install or execute its code.
          </p>
          <table className={styles.contractTable}>
            <thead>
              <tr>
                <th>Your system</th>
                <th>Onboarding route</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Prompt with structured output</td>
                <td>
                  Adapt the starter manifest. Use <code>input</code> →{" "}
                  <code>llm_response</code> → <code>output</code>.
                </td>
              </tr>
              <tr>
                <td>Custom Python transforms or tools</td>
                <td>
                  Register system-scoped handlers that return state updates. Add
                  the manifest once those handlers are available.
                </td>
              </tr>
              <tr>
                <td>Another agent framework</td>
                <td>
                  Preserve the real tools, state, and control flow in an
                  adapter. Model comparison requires model calls to use
                  AutoEval&apos;s inference provider.
                </td>
              </tr>
            </tbody>
          </table>
          <p>
            The code-level adapter follows <code>docs/extension-guide.md</code>:
            a plugin, graph definition, handlers, scoring, synthetic tests, and
            a trace policy when needed. The importer validates registration
            before a system becomes runnable.
          </p>
          <CodeBlock
            title="Ask your coding agent to onboard"
            code={codingAgentBrief}
            collapsible
          />
          <p>
            Use the brief in your existing coding-agent session, review its
            changes, then return to import. Automatic conversion is a separate
            extension: a future coding worker should produce this same manifest
            and adapter patch for review.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className="app-button secondary"
              onClick={() =>
                downloadText(
                  "autoeval-adapter-brief.md",
                  codingAgentBrief,
                  "text/markdown",
                )
              }
            >
              <DownloadSimpleIcon size={14} />
              Download adapter brief
            </button>
            <Link href="/import" className={styles.inlineLink}>
              Import the prepared system <ArrowRightIcon size={14} />
            </Link>
          </div>
        </section>
        <section className={styles.guideSection} id="local-models">
          <h2>Run locally with LM Studio</h2>
          <p>
            Load a model in LM Studio and start its local server. Copy the model
            ID returned by <code>/v1/models</code> into AutoEval&apos;s backend{" "}
            <code>.env</code>, then restart AutoEval. Inference goes from the
            backend to your local model.
          </p>
          <CodeBlock
            title="Find the model ID"
            code="curl http://127.0.0.1:1234/v1/models"
          />
          <CodeBlock title="AutoEval .env" code={localSetup} />
          <p>
            Set <code>LM_STUDIO_API_TOKEN</code> in the backend environment if
            your LM Studio server requires authentication. Separate multiple
            model IDs with commas. Use a model that can follow the graph&apos;s
            JSON response schema.
          </p>
          <CodeBlock
            title="Restart AutoEval after saving .env"
            code="make dev"
          />
          <div className={styles.modelList} aria-live="polite">
            {catalog.loading ? (
              <p className={styles.guideNote}>Reading configured models...</p>
            ) : catalog.error ? (
              <p className={styles.guideNote}>
                Start the AutoEval backend to see configured local models.
              </p>
            ) : localModels.length ? (
              <>
                <p className={styles.guideNote}>
                  Configured in this workspace. Availability is checked when you
                  run inference.
                </p>
                {localModels.map((model) => (
                  <span key={model.id}>{model.id}</span>
                ))}
              </>
            ) : (
              <p className={styles.guideNote}>
                No LM Studio models are configured in this workspace yet.
              </p>
            )}
          </div>
          <button
            type="button"
            className={styles.inlineLink}
            onClick={() => void catalog.reload()}
          >
            Refresh configured models
          </button>
          <p>
            Local inference records latency and reported tokens. Its provider
            charge is $0; hardware and electricity are outside that number. If a
            model fails, the trace keeps the error so you can inspect it.
          </p>
          <p>
            <a
              href="https://lmstudio.ai/docs/developer/openai-compat"
              target="_blank"
              rel="noreferrer"
            >
              LM Studio API documentation
            </a>
          </p>
        </section>
        <section className={styles.guideSection} id="evaluate">
          <h2>Make the first run count</h2>
          <p>
            Run one synthetic request. Open the trace, review the expected
            output, and add it to the new draft dataset. Finalize that dataset
            to compare models on the same examples. Imported systems start with
            exact JSON scoring; add a custom scorer for domain-specific quality.
          </p>
          <div className={styles.actions}>
            <Link href="/import" className="app-button">
              Import your agent <ArrowRightIcon size={14} />
            </Link>
            <Link href="/systems" className="app-button secondary">
              Browse systems
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}

function CodeBlock({
  title,
  code,
  collapsible = false,
}: {
  title: string;
  code: string;
  collapsible?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setError(false);
    } catch {
      setError(true);
    }
  }
  const source = (
    <pre tabIndex={0}>
      <code>{code}</code>
    </pre>
  );
  return (
    <div className={styles.codeBlock}>
      <div>
        <span>{title}</span>
        <button
          type="button"
          className={styles.inlineLink}
          onClick={copy}
          aria-label={`Copy ${title}`}
        >
          <CopyIcon size={12} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {collapsible ? (
        <details className={styles.details}>
          <summary>Read the brief</summary>
          {source}
        </details>
      ) : (
        source
      )}
      {error ? (
        <p role="alert" className={styles.guideNote}>
          Clipboard unavailable. Select the text to copy it.
        </p>
      ) : null}
    </div>
  );
}
