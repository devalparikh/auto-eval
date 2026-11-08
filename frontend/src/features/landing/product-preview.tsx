"use client";

import {
  ArrowCounterClockwiseIcon,
  BracketsCurlyIcon,
  CheckIcon,
  CloudArrowDownIcon,
  FileCodeIcon,
  LockSimpleIcon,
  WaveformIcon,
  XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { Badge, BadgeSwap } from "@/features/landing/feature-cards";
import { useSceneActive, useSteps } from "@/features/landing/landing-motion";
import s from "@/features/landing/preview.module.css";

/*
 * Live, reduced-scale copies of the workbench. Every stage renders inside a
 * frame of fixed size, so switching stages or playing a scene never moves
 * anything around it. Late content is rendered from the start and revealed.
 *
 * The four stages tell one story: connect the agent, open a run that failed
 * its grounding check, save that run as a test case, then benchmark every
 * candidate on the locked dataset.
 */

const stages = [
  {
    key: "connect",
    index: "01",
    label: "Connect",
    meta: "plugin.py",
    crumb: "setup",
    narration:
      "One plugin registers the graph, handlers, and scoring. Your code stays in its own package.",
  },
  {
    key: "observe",
    index: "02",
    label: "Trace",
    meta: "tr_01J8F2KQ",
    crumb: "traces / tr_01J8F2KQ",
    narration:
      "Open a run to see every node, model call, and timing. This one failed its grounding check.",
  },
  {
    key: "curate",
    index: "03",
    label: "Save",
    meta: "failure-modes v4",
    crumb: "datasets / failure-modes",
    narration:
      "Save the failed run as a test case, then finalize the dataset to lock it.",
  },
  {
    key: "evaluate",
    index: "04",
    label: "Compare",
    meta: "6 candidates",
    crumb: "evaluations / 024",
    narration:
      "Run every candidate on the same locked cases. Compare quality, cost, and latency.",
  },
] as const;

type Stage = (typeof stages)[number]["key"];

type SceneProps = {
  running: boolean;
  reduceMotion: boolean;
  onInteract?: () => void;
};

/** Every scene settles within about four seconds, then holds to be read. */
const AUTO_ADVANCE_MS = 7200;
const settle = [0.22, 1, 0.36, 1] as const;
const TAB_KEYS: Record<string, number> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

/** The hero: the evaluation loop as four steps of one product window. */
export function ProductPreview() {
  const rootRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { active: inView, reduceMotion } = useSceneActive(rootRef);
  const [activeStage, setActiveStage] = useState<Stage>("observe");
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const activeIndex = stages.findIndex((stage) => stage.key === activeStage);
  const active = stages[activeIndex];
  const next = stages[(activeIndex + 1) % stages.length];
  // Pauses while pointed at or focused, and stops for good once a visitor
  // picks a step themselves.
  const autoplay = inView && !hovered && !focused && !interacted;

  useEffect(() => {
    if (!autoplay) return;
    const timer = setTimeout(() => setActiveStage(next.key), AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [autoplay, next.key]);

  function select(stage: Stage) {
    setInteracted(true);
    setActiveStage(stage);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = TAB_KEYS[event.key];
    let target: number | null = null;
    if (step) target = (activeIndex + step + stages.length) % stages.length;
    if (event.key === "Home") target = 0;
    if (event.key === "End") target = stages.length - 1;
    if (target === null) return;
    event.preventDefault();
    select(stages[target].key);
    tabRefs.current[target]?.focus();
  }

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="Interactive AutoEval workflow"
      className={`${s.root} ${s.hero}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
    >
      <div className={s.previewWindow}>
        <WindowChrome crumb={active.crumb} />
        <div className={s.tourBody}>
          <div className={s.rail}>
            <div className={s.workspace} aria-hidden="true">
              <span className={s.workspaceMark}>ra</span>
              <span className={s.workspaceName}>
                <b>research-assistant</b>
                <small>local workspace</small>
              </span>
              <i className={s.chevron} />
            </div>
            <div className={s.railLabel} aria-hidden="true">
              <span>Evaluation loop</span>
              <span>
                {activeIndex + 1} / {stages.length}
              </span>
            </div>
            <div
              role="tablist"
              aria-label="AutoEval workflow steps"
              aria-orientation="vertical"
              className={s.tabs}
              onKeyDown={onTabKeyDown}
            >
              {stages.map((stage, index) => {
                const selected = stage.key === activeStage;
                return (
                  <button
                    key={stage.key}
                    ref={(node) => {
                      tabRefs.current[index] = node;
                    }}
                    id={`autoeval-workflow-tab-${stage.key}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls="autoeval-workflow-panel"
                    tabIndex={selected ? 0 : -1}
                    className={s.tab}
                    data-state={
                      selected ? "active" : index < activeIndex ? "done" : "todo"
                    }
                    onClick={() => select(stage.key)}
                  >
                    <span className={s.tabIndex} aria-hidden="true">
                      {stage.index}
                    </span>
                    <span className={s.tabCopy}>
                      <b>{stage.label}</b>
                      <small aria-hidden="true">{stage.meta}</small>
                    </span>
                    <i className={s.tabState} aria-hidden="true" />
                    {selected && autoplay ? (
                      <i
                        className={s.tabProgress}
                        aria-hidden="true"
                        style={
                          {
                            "--progress-duration": `${AUTO_ADVANCE_MS}ms`,
                          } as CSSProperties
                        }
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
          <div
            id="autoeval-workflow-panel"
            role="tabpanel"
            aria-labelledby={`autoeval-workflow-tab-${active.key}`}
            className={s.stageArea}
          >
            {/* Both takes share one fixed frame, so the swap is a crossfade
                with nothing reflowing behind it. */}
            <AnimatePresence initial={false}>
              <motion.div
                key={active.key}
                className={s.take}
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{
                  opacity: 0,
                  transition: { duration: reduceMotion ? 0 : 0.2, ease: settle },
                }}
                transition={{ duration: reduceMotion ? 0 : 0.32, ease: settle }}
              >
                {active.key === "connect" ? (
                  <ConnectScene running={inView} reduceMotion={reduceMotion} />
                ) : null}
                {active.key === "observe" ? (
                  <TraceScene
                    running={inView}
                    reduceMotion={reduceMotion}
                    onInteract={() => setInteracted(true)}
                  />
                ) : null}
                {active.key === "curate" ? (
                  <DatasetScene running={inView} reduceMotion={reduceMotion} />
                ) : null}
                {active.key === "evaluate" ? (
                  <EvaluationScene
                    running={inView}
                    reduceMotion={reduceMotion}
                  />
                ) : null}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
      <div className={s.caption}>
        <span className={s.captionStep} aria-hidden="true">
          {active.index} / 0{stages.length}
        </span>
        {/* Every line sits in one grid cell, so the caption is always as tall
            as the longest and never changes height between steps. */}
        <p className={s.captionText}>
          {stages.map((stage) => (
            <span
              key={stage.key}
              data-active={stage.key === activeStage ? "true" : "false"}
              aria-hidden={stage.key === activeStage ? undefined : true}
            >
              {stage.narration}
            </span>
          ))}
        </p>
        <button
          type="button"
          className={s.captionNext}
          onClick={() => select(next.key)}
        >
          continue to {next.label.toLowerCase()}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}

/** The benchmark band: one finished comparison, built once when it is seen. */
export function BenchmarkPreview() {
  const rootRef = useRef<HTMLDivElement>(null);
  const { active: inView, reduceMotion } = useSceneActive(rootRef);
  const beat = useSteps(BENCH_BEATS, inView);
  const step = reduceMotion ? BENCH_BEATS.length : beat;
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="Sample benchmark results"
      className={s.root}
    >
      <div className={s.previewWindow}>
        <WindowChrome crumb="evaluations / 024" />
        <div className={s.benchBody}>
          <SceneHeader
            path="research-assistant / evaluations"
            title="comparison / 024"
            status={
              <Badge tone="success">Complete</Badge>
            }
          />
          <div className={`${s.scene} ${s.bench}`}>
            <EvalSummary complete resolved={768} />
            <div className={s.benchGrid}>
              <ScoreCostChart
                scored={step >= 1}
                complete={step >= 2}
                hovered={hovered}
                onHover={setHovered}
                reduceMotion={reduceMotion}
              />
              <CaseMatrix show={step >= 2} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WindowChrome({ crumb }: { crumb: string }) {
  return (
    <div className={s.chrome} aria-hidden="true">
      <span className={s.dots}>
        <i />
        <i />
        <i />
      </span>
      <span className={s.crumbs}>
        <b>research-assistant</b>
        <span>/</span>
        <span className={s.crumbTail}>{crumb}</span>
      </span>
      <span className={s.tools}>
        <span className={s.search}>
          search <kbd>⌘K</kbd>
        </span>
        <span className={s.local}>
          <i /> local
        </span>
      </span>
    </div>
  );
}

function SceneHeader({
  path,
  title,
  status,
}: {
  path: string;
  title: string;
  status: ReactNode;
}) {
  return (
    <header className={s.header}>
      <div className={s.headerCopy}>
        <span>{path}</span>
        <strong>{title}</strong>
      </div>
      <span className={s.headerStatus}>{status}</span>
    </header>
  );
}

/* Connect ----------------------------------------------------------------- */

const kw = (text: string) => <span className={s.kw}>{text}</span>;
const attr = (text: string) => <span className={s.attr}>{text}</span>;
const str = (text: string) => <span className={s.str}>&quot;{text}&quot;</span>;

// The real shape of a plugin file: the registry import, then one PLUGIN.
const pluginSource: ReactNode[] = [
  <>
    {kw("from")} autoeval_api.agent_systems.registry {kw("import")} (
  </>,
  <>{"    "}AgentSystemPlugin, AgentSystemSpec,</>,
  <>)</>,
  null,
  <>
    {attr("PLUGIN")} = AgentSystemPlugin(
  </>,
  <>
    {"    "}
    {attr("package")}={str("research_assistant")},
  </>,
  <>
    {"    "}
    {attr("spec")}=AgentSystemSpec(
  </>,
  <>
    {"        "}
    {attr("key")}={str("research-assistant")},
  </>,
  <>
    {"        "}
    {attr("default_model_ids")}=({str("claude-sonnet-5")},),
  </>,
  <>{"    "}),</>,
  <>)</>,
];
const TYPED_LINE = 8;

// The package as a file tree, alphabetical. `read` is the beat at which the
// adapter has read the file; __init__.py is never read on its own.
const packageFiles = [
  { name: "__init__.py", read: null },
  { name: "definition.py", read: 2 },
  { name: "handlers.py", read: 3 },
  { name: "plugin.py", read: 1 },
  { name: "scoring.py", read: 4 },
  { name: "seed.py", read: 4 },
  { name: "trace_policy.py", read: 5 },
] as const;

// What the adapter derives from each file after plugin.py.
const contract = [
  { name: "graph", detail: "4 nodes, one path" },
  { name: "handlers", detail: "normalize, retrieve, format" },
  { name: "scoring", detail: "grounding, citation_format" },
  { name: "trace policy", detail: "redacts inputs" },
] as const;

// Typing, then the adapter reads one file per beat.
const CONNECT_BEATS = [1300, 450, 450, 450, 450] as const;

function ConnectScene({ running, reduceMotion }: SceneProps) {
  const beat = useSteps(CONNECT_BEATS, running);
  const step = reduceMotion ? CONNECT_BEATS.length : beat;
  const registered = step >= CONNECT_BEATS.length;

  return (
    <>
      <SceneHeader
        path="research-assistant / setup"
        title="research-assistant / v7"
        status={
          <BadgeSwap
            active={registered ? 1 : 0}
            items={[
              <Badge key="reading" tone="warning" spinning>
                Reading plugin
              </Badge>,
              <Badge key="done" tone="success">
                Registered
              </Badge>,
            ]}
          />
        }
      />
      <div className={`${s.scene} ${s.connect}`}>
        <div className={s.files}>
          <span className={s.paneLabel}>research_assistant/</span>
          <ul>
            {packageFiles.map((file) => (
              <li
                key={file.name}
                data-open={file.name === "plugin.py" ? "true" : "false"}
                data-read={
                  file.read !== null && step >= file.read ? "true" : "false"
                }
              >
                <FileCodeIcon size={12} aria-hidden="true" />
                <span>{file.name}</span>
                <i aria-hidden="true">
                  <CheckIcon size={8} weight="bold" />
                </i>
              </li>
            ))}
          </ul>
        </div>
        <div className={s.editor}>
          <div className={s.editorTab}>
            <FileCodeIcon size={11} aria-hidden="true" />
            plugin.py
          </div>
          <pre>
            {pluginSource.map((line, index) => (
              <span
                key={index}
                className={s.codeLine}
                data-typing={
                  index === TYPED_LINE && step === 0 && running
                    ? "true"
                    : undefined
                }
              >
                <b>{index + 1}</b>
                <code>{line}</code>
              </span>
            ))}
          </pre>
        </div>
        <div className={s.contract}>
          <div className={s.contractHead}>
            <b>CODE ADAPTER</b>
            <span>derived from the package</span>
          </div>
          <ul>
            {contract.map((row, index) => (
              <li
                key={row.name}
                data-done={step >= index + 2 ? "true" : "false"}
              >
                <span>{row.name}</span>
                <small>{row.detail}</small>
                <i aria-hidden="true">
                  <CheckIcon size={9} weight="bold" />
                </i>
              </li>
            ))}
          </ul>
          <p className={s.contractFoot} data-show={registered ? "true" : "false"}>
            ready to run
          </p>
        </div>
        <div className={s.derived} data-show={step >= 2 ? "true" : "false"}>
          <span className={s.derivedLabel}>
            <b>graph v7</b>
            <small>from definition.py</small>
          </span>
          <div className={s.derivedPath} aria-hidden="true">
            {traceNodes.map((node, index) => {
              const { Icon } = nodeTypes[node.type];
              return (
                <span
                  key={node.name}
                  className={s.miniNode}
                  data-type={node.type}
                  style={{ "--i": index } as CSSProperties}
                >
                  <span className={s.nodeIcon}>
                    <Icon size={10} weight="bold" />
                  </span>
                  {node.name}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

/* Trace ------------------------------------------------------------------- */

const TRACE_MS = 968;

const nodeTypes = {
  logic: { label: "Logic", Icon: BracketsCurlyIcon },
  live: { label: "Live data", Icon: CloudArrowDownIcon },
  model: { label: "Model", Icon: WaveformIcon },
} as const;

const traceNodes = [
  {
    name: "normalize",
    type: "logic",
    start: 0,
    ms: 2,
    facts: [
      ["Handler", "normalize_query"],
      ["Replay", "deterministic"],
    ],
    output: '{ "query": "2024 retrieval benchmark",\n  "language": "en" }',
  },
  {
    name: "retrieve",
    type: "live",
    start: 2,
    ms: 142,
    facts: [
      ["Snapshot", "93f2 · frozen"],
      ["Documents", "3"],
    ],
    output: '["beir-2", "mteb-v2", "lotte"]',
  },
  {
    name: "generate",
    type: "model",
    start: 144,
    ms: 820,
    facts: [
      ["Model", "claude-sonnet-5"],
      ["Tokens", "1,284"],
      ["Cost", "$0.0042"],
    ],
    output: '"Introduced in BEIR-2\n [arxiv:2403.0117]."',
  },
  {
    name: "format",
    type: "logic",
    start: 964,
    ms: 4,
    facts: [
      ["Handler", "add_citations"],
      ["Citations", "1"],
    ],
    output: '{ "citations":\n  ["arxiv:2403.0117"] }',
  },
] as const;

const scoringResults = [
  {
    name: "grounding",
    score: "0.41",
    passed: false,
    note: "cites arxiv:2403.0117, which no retrieved document contains",
  },
  {
    name: "citation_format",
    score: "1.00",
    passed: true,
    note: "one citation, well formed",
  },
] as const;

// One beat per node, then the scoring entries run on the output.
const TRACE_BEATS = [450, 650, 1100, 500, 700] as const;
const GENERATE = 2;

function TraceScene({ running, reduceMotion, onInteract }: SceneProps) {
  const [pinned, setPinned] = useState<number | null>(null);
  const [replay, setReplay] = useState(0);
  const beat = useSteps(TRACE_BEATS, running && pinned === null, replay);
  const step =
    reduceMotion || pinned !== null ? TRACE_BEATS.length : beat;
  const finished = step >= TRACE_BEATS.length;
  // Playback follows the running node; once the check fails, it lands on the
  // model call that caused it.
  const selectedIndex =
    pinned ?? (finished ? GENERATE : Math.min(step, traceNodes.length - 1));
  const selected = traceNodes[selectedIndex];
  const snapshot = step >= 2 ? "frozen" : step === 1 ? "capturing" : "idle";
  const statusOf = (index: number) =>
    index < step ? "complete" : index === step ? "running" : "pending";

  function pin(index: number) {
    setPinned(index);
    onInteract?.();
  }

  return (
    <>
      <SceneHeader
        path="research-assistant / traces · graph v7"
        title="tr_01J8F2KQ"
        status={
          <BadgeSwap
            active={finished ? 1 : 0}
            items={[
              <Badge key="running" tone="warning" spinning>
                Running
              </Badge>,
              <Badge key="failed" tone="danger">
                1 check failed
              </Badge>,
            ]}
          />
        }
      />
      <div className={`${s.scene} ${s.trace}`}>
        <div className={s.traceMain}>
          <div className={s.toolbar}>
            {pinned === null ? (
              <span>
                <i data-live={finished ? "false" : "true"} aria-hidden="true" />
                {finished
                  ? "968 ms · 1 model call · click a node to inspect it"
                  : "replaying the run"}
              </span>
            ) : (
              <>
                <span>inspecting {selected.name} · playback stopped</span>
                <button
                  type="button"
                  onClick={() => {
                    setPinned(null);
                    setReplay((count) => count + 1);
                  }}
                >
                  <ArrowCounterClockwiseIcon
                    size={10}
                    weight="bold"
                    aria-hidden="true"
                  />
                  replay
                </button>
              </>
            )}
          </div>

          <div className={s.graph}>
            {traceNodes.map((node, index) => {
              const { Icon, label } = nodeTypes[node.type];
              const status = statusOf(index);
              return (
                <div key={node.name} className={s.graphCell}>
                  {index > 0 ? (
                    <i
                      className={s.edge}
                      data-active={step >= index ? "true" : "false"}
                      aria-hidden="true"
                    />
                  ) : null}
                  <button
                    type="button"
                    className={s.node}
                    data-type={node.type}
                    data-status={status}
                    data-selected={index === selectedIndex ? "true" : "false"}
                    aria-label={`Inspect ${node.name} node`}
                    aria-pressed={pinned === index}
                    onClick={() => pin(index)}
                  >
                    <span className={s.nodeIcon} aria-hidden="true">
                      <Icon size={11} weight="bold" />
                    </span>
                    <span className={s.nodeCopy}>
                      <b>{node.name}</b>
                      <small>
                        {status === "complete"
                          ? `${node.ms} ms`
                          : status === "running"
                            ? "running…"
                            : label.toLowerCase()}
                      </small>
                    </span>
                    <i className={s.nodeDot} aria-hidden="true" />
                  </button>
                  {node.type === "live" ? (
                    <span
                      className={s.snapshot}
                      data-state={snapshot}
                      aria-hidden="true"
                    >
                      {snapshot === "frozen"
                        ? "snapshot 93f2 · frozen"
                        : snapshot === "capturing"
                          ? "capturing documents…"
                          : "captured on first run"}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className={s.timeline}>
            <div className={s.axis} aria-hidden="true">
              <span>0 ms</span>
              <span>484</span>
              <span>{TRACE_MS} ms</span>
            </div>
            {traceNodes.map((node, index) => (
              <button
                key={node.name}
                type="button"
                className={s.span}
                data-type={node.type}
                data-show={index < step ? "true" : "false"}
                data-selected={index === selectedIndex ? "true" : "false"}
                aria-label={`Inspect ${node.name} span`}
                onClick={() => pin(index)}
                style={
                  {
                    "--start": `${(node.start / TRACE_MS) * 100}%`,
                    "--width": `${Math.max((node.ms / TRACE_MS) * 100, 0.7)}%`,
                  } as CSSProperties
                }
              >
                <span className={s.spanName}>{node.name}</span>
                <span className={s.spanTrack}>
                  <i />
                </span>
                <span className={s.spanMs}>
                  {index < step ? `${node.ms} ms` : ""}
                </span>
              </button>
            ))}
          </div>

          <div className={s.scoring}>
            <span className={s.paneLabel}>Scoring</span>
            {scoringResults.map((entry, index) => (
              <div
                key={entry.name}
                className={s.scoreRow}
                data-passed={entry.passed ? "true" : "false"}
                data-show={finished ? "true" : "false"}
                style={{ "--i": index } as CSSProperties}
              >
                <i aria-hidden="true">
                  {entry.passed ? (
                    <CheckIcon size={9} weight="bold" />
                  ) : (
                    <XIcon size={9} weight="bold" />
                  )}
                </i>
                <b>{entry.name}</b>
                <span>{finished ? entry.score : "—"}</span>
                <small>{entry.note}</small>
              </div>
            ))}
          </div>
        </div>

        <aside className={s.inspector} aria-label="Selected node">
          <span className={s.paneLabel}>Node</span>
          <div key={selected.name} className={s.inspectorBody}>
            <strong>{selected.name}</strong>
            <span className={s.inspectorType} data-type={selected.type}>
              {nodeTypes[selected.type].label}
            </span>
            <dl>
              <div>
                <dt>Status</dt>
                <dd data-tone={selectedIndex < step ? "ok" : "warn"}>
                  {selectedIndex < step ? "complete" : "running"}
                </dd>
              </div>
              <div>
                <dt>Latency</dt>
                <dd>{selectedIndex < step ? `${selected.ms} ms` : "…"}</dd>
              </div>
              {selected.facts.map(([term, value]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <span className={s.paneLabel}>Output</span>
            <pre>{selectedIndex < step ? selected.output : "…"}</pre>
          </div>
        </aside>
      </div>
    </>
  );
}

/* Save -------------------------------------------------------------------- */

const savedCases = [
  ["001", "Ambiguous retrieval", "tr_01J8E1RZ"],
  ["002", "Missing source citation", "tr_01J8E9MP"],
  ["003", "Conflicting context", "tr_01J8D44A"],
] as const;

// The list, the failed run arriving as case 004, the press, then the lock.
const DATASET_BEATS = [900, 1500, 700] as const;

function DatasetScene({ running, reduceMotion }: SceneProps) {
  const beat = useSteps(DATASET_BEATS, running);
  const step = reduceMotion ? DATASET_BEATS.length : beat;
  const added = step >= 1;
  const pressing = step === 2;
  const finalized = step >= 3;

  return (
    <>
      <SceneHeader
        path="research-assistant / datasets"
        title="failure-modes / v4"
        status={
          <BadgeSwap
            active={finalized ? 1 : 0}
            items={[
              <Badge key="draft" tone="warning">
                Draft
              </Badge>,
              <Badge key="final" tone="success">
                Finalized
              </Badge>,
            ]}
          />
        }
      />
      <div className={`${s.scene} ${s.dataset}`}>
        <div className={s.datasetBar}>
          <span>
            <b>{added ? 128 : 127}</b> cases
          </span>
          <span className={s.datasetAdded} data-show={added ? "true" : "false"}>
            +1 from tr_01J8F2KQ
          </span>
          <span
            className={s.finalize}
            data-state={finalized ? "done" : pressing ? "pressed" : "idle"}
          >
            <LockSimpleIcon size={11} weight="bold" aria-hidden="true" />
            Finalize v4
          </span>
        </div>
        <div className={s.cases}>
          <div className={s.caseHead}>
            <span>Case</span>
            <span>Name</span>
            <span>Source run</span>
            <span>Status</span>
          </div>
          {savedCases.map(([id, name, source]) => (
            <div key={id} className={s.caseRow}>
              <span>{id}</span>
              <strong>{name}</strong>
              <code>{source}</code>
              <em>reviewed</em>
            </div>
          ))}
          <div className={s.caseMore}>124 more reviewed cases</div>
          <div
            className={s.caseRow}
            data-new="true"
            data-show={added ? "true" : "false"}
          >
            <span>128</span>
            <strong>Grounding cites outside context</strong>
            <code>tr_01J8F2KQ</code>
            <em>new</em>
          </div>
        </div>
        <div className={s.caseDetail} data-show={added ? "true" : "false"}>
          <div style={{ "--i": 0 } as CSSProperties}>
            <span>Input</span>
            <p>
              &ldquo;Which 2024 paper introduced the retrieval benchmark we use
              in evals?&rdquo;
            </p>
          </div>
          <div style={{ "--i": 1 } as CSSProperties}>
            <span>Why it was saved</span>
            <p>
              Cited arxiv:2403.0117, which none of the three retrieved documents
              contain.
            </p>
          </div>
          <div style={{ "--i": 2 } as CSSProperties}>
            <span>Scoring</span>
            <p>grounding · citation_format</p>
          </div>
        </div>
        <footer className={s.datasetFoot}>
          <span>
            {finalized
              ? "v4 is locked · new cases go to v5"
              : "source run attached"}
          </span>
          <code>graph v7 · prompt v12 · snapshot 93f2</code>
        </footer>
      </div>
    </>
  );
}

/* Compare ----------------------------------------------------------------- */

const candidates = [
  {
    name: "Claude Opus 5",
    vendor: "anthropic",
    score: 95,
    cost: 0.062,
    passed: 122,
    tokens: "2,410",
    latency: "2.1s",
  },
  {
    name: "Claude Sonnet 5",
    vendor: "anthropic",
    score: 93,
    cost: 0.021,
    passed: 119,
    tokens: "1,284",
    latency: "1.2s",
  },
  {
    name: "ra-sonnet-ft-v3",
    vendor: "finetune",
    score: 92,
    cost: 0.006,
    passed: 118,
    tokens: "690",
    latency: "0.7s",
    best: true,
  },
  {
    name: "GPT-5",
    vendor: "openai",
    score: 91,
    cost: 0.028,
    passed: 116,
    tokens: "1,530",
    latency: "1.4s",
  },
  {
    name: "Claude Haiku 4.5",
    vendor: "anthropic",
    score: 86,
    cost: 0.004,
    passed: 110,
    tokens: "910",
    latency: "0.6s",
  },
  {
    name: "Sonnet 5 · graph v8",
    vendor: "graph",
    graph: "v8",
    score: 96,
    cost: 0.014,
    passed: 123,
    tokens: "1,020",
    latency: "1.0s",
  },
] as const;

type Candidate = (typeof candidates)[number];

const vendorLabels: Record<Candidate["vendor"], string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  finetune: "Fine-tuned (yours)",
  graph: "Your graph change",
};

// Points and their labels enter cheapest first, so the eye reads the axis.
const costRank = [...candidates]
  .sort((a, b) => a.cost - b.cost)
  .map((candidate) => candidate.name);
const ranked = [...candidates].sort((a, b) => b.score - a.score);

const EVAL_BEATS = [700, 1600] as const;
const BENCH_BEATS = [300, 1300] as const;

function EvaluationScene({ running, reduceMotion }: SceneProps) {
  const beat = useSteps(EVAL_BEATS, running);
  const step = reduceMotion ? EVAL_BEATS.length : beat;
  const scored = step >= 1;
  const complete = step >= 2;
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <>
      <SceneHeader
        path="research-assistant / evaluations"
        title="comparison / 024"
        status={
          <BadgeSwap
            active={complete ? 1 : 0}
            items={[
              <Badge key="running" tone="warning" spinning>
                768 runs in flight
              </Badge>,
              <Badge key="done" tone="success">
                Complete
              </Badge>,
            ]}
          />
        }
      />
      <div className={`${s.scene} ${s.evaluate}`}>
        <EvalSummary
          complete={complete}
          resolved={complete ? 768 : scored ? 612 : 180}
        />
        <div className={s.evalGrid}>
          <ScoreCostChart
            scored={scored}
            complete={complete}
            hovered={hovered}
            onHover={setHovered}
            reduceMotion={reduceMotion}
          />
          <Leaderboard
            scored={scored}
            complete={complete}
            hovered={hovered}
            onHover={setHovered}
          />
        </div>
      </div>
    </>
  );
}

function EvalSummary({
  complete,
  resolved,
}: {
  complete: boolean;
  resolved: number;
}) {
  return (
    <dl className={s.summary}>
      <div>
        <dt>Status</dt>
        <dd data-tone={complete ? "ok" : "warn"}>
          ● {complete ? "complete" : "running"}
        </dd>
      </div>
      <div>
        <dt>Dataset</dt>
        <dd>failure-modes / v4</dd>
      </div>
      <div>
        <dt>Cases</dt>
        <dd>128 × 6 candidates</dd>
      </div>
      <div>
        <dt>Runs</dt>
        <dd className={s.runs}>
          <span>{resolved} / 768</span>
          <i aria-hidden="true">
            <b style={{ transform: `scaleX(${resolved / 768})` }} />
          </i>
        </dd>
      </div>
    </dl>
  );
}

const CHART = { w: 400, h: 290, left: 34, right: 12, top: 10, bottom: 32 };
const X_MAX = 0.07;
const Y_MIN = 80;
const Y_MAX = 100;
const xTicks = [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07];
const yTicks = [80, 85, 90, 95, 100];

function chartX(cost: number) {
  return CHART.left + (cost / X_MAX) * (CHART.w - CHART.left - CHART.right);
}

function chartY(score: number) {
  return (
    CHART.top +
    (1 - (score - Y_MIN) / (Y_MAX - Y_MIN)) *
      (CHART.h - CHART.top - CHART.bottom)
  );
}

function ScoreCostChart({
  scored,
  complete,
  hovered,
  onHover,
  reduceMotion,
}: {
  scored: boolean;
  complete: boolean;
  hovered: string | null;
  onHover: (name: string | null) => void;
  reduceMotion: boolean;
}) {
  const hoveredCandidate = scored
    ? (candidates.find((candidate) => candidate.name === hovered) ?? null)
    : null;

  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <strong>Eval score vs. cost per case</strong>
        <span>grounding + citation_format</span>
      </div>
      <div className={s.plot}>
        <svg
          viewBox={`0 0 ${CHART.w} ${CHART.h}`}
          className={s.plotSvg}
          role="list"
          aria-label="Candidates by eval score and cost per case"
        >
          <rect
            className={s.quadrant}
            data-show={complete ? "true" : "false"}
            x={chartX(0)}
            y={chartY(100)}
            width={chartX(0.012) - chartX(0)}
            height={chartY(88) - chartY(100)}
          />
          <text
            className={s.quadrantLabel}
            data-show={complete ? "true" : "false"}
            x={chartX(0) + 6}
            y={chartY(100) + 12}
          >
            best value
          </text>
          {yTicks.map((tick) => (
            <g key={tick} aria-hidden="true">
              <line
                className={s.grid}
                x1={CHART.left}
                x2={CHART.w - CHART.right}
                y1={chartY(tick)}
                y2={chartY(tick)}
              />
              <text
                className={s.tick}
                x={CHART.left - 6}
                y={chartY(tick) + 3}
                textAnchor="end"
              >
                {tick}%
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <g key={tick} aria-hidden="true">
              <line
                className={s.grid}
                y1={CHART.top}
                y2={CHART.h - CHART.bottom}
                x1={chartX(tick)}
                x2={chartX(tick)}
              />
              <text
                className={s.tick}
                x={chartX(tick)}
                y={CHART.h - CHART.bottom + 12}
                textAnchor="middle"
              >
                {tick === 0 ? "$0" : `$${tick.toFixed(2)}`}
              </text>
            </g>
          ))}
          <text
            className={s.axisLabel}
            x={(CHART.left + CHART.w - CHART.right) / 2}
            y={CHART.h - 3}
            textAnchor="middle"
            aria-hidden="true"
          >
            cost per case
          </text>
          {candidates.map((candidate) => {
            const cx = chartX(candidate.cost);
            const cy = chartY(candidate.score);
            const labelLeft = candidate.cost > 0.05;
            const best = "best" in candidate;
            return (
              <g
                key={candidate.name}
                role="listitem"
                tabIndex={0}
                aria-label={`${candidate.name}: ${candidate.score}% at $${candidate.cost.toFixed(3)} per case`}
                className={s.point}
                data-vendor={candidate.vendor}
                data-show={scored ? "true" : "false"}
                data-best={best ? "true" : "false"}
                data-hovered={hovered === candidate.name ? "true" : "false"}
                data-dimmed={
                  hovered !== null && hovered !== candidate.name
                    ? "true"
                    : "false"
                }
                style={
                  { "--i": costRank.indexOf(candidate.name) } as CSSProperties
                }
                onMouseEnter={() => onHover(candidate.name)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(candidate.name)}
                onBlur={() => onHover(null)}
              >
                <circle className={s.pointHit} cx={cx} cy={cy} r="13" />
                {best && complete && !reduceMotion ? (
                  <circle className={s.pointRing} cx={cx} cy={cy} r="5" />
                ) : null}
                <circle className={s.pointDot} cx={cx} cy={cy} r="4.5" />
                <text
                  x={labelLeft ? cx - 8 : cx + (best ? 13 : 8)}
                  y={cy + 3.5}
                  textAnchor={labelLeft ? "end" : "start"}
                >
                  {candidate.name}
                </text>
              </g>
            );
          })}
        </svg>
        <AnimatePresence>
          {hoveredCandidate ? (
            <motion.div
              key={hoveredCandidate.name}
              className={s.tooltip}
              data-vendor={hoveredCandidate.vendor}
              data-flip={hoveredCandidate.cost > 0.04 ? "true" : "false"}
              style={
                {
                  "--tx": `${(chartX(hoveredCandidate.cost) / CHART.w) * 100}%`,
                  "--ty": `${(chartY(hoveredCandidate.score) / CHART.h) * 100}%`,
                } as CSSProperties
              }
              initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={{ duration: 0.16, ease: settle }}
            >
              <header>
                <i />
                <strong>{hoveredCandidate.name}</strong>
                <span>{vendorLabels[hoveredCandidate.vendor]}</span>
              </header>
              <dl>
                <div>
                  <dt>Eval score</dt>
                  <dd>{hoveredCandidate.score}%</dd>
                </div>
                <div>
                  <dt>Cases passed</dt>
                  <dd>{hoveredCandidate.passed} / 128</dd>
                </div>
                <div>
                  <dt>Cost per case</dt>
                  <dd>${hoveredCandidate.cost.toFixed(3)}</dd>
                </div>
                <div>
                  <dt>Avg latency</dt>
                  <dd>{hoveredCandidate.latency}</dd>
                </div>
              </dl>
              <footer>
                failure-modes v4 · graph{" "}
                {"graph" in hoveredCandidate ? hoveredCandidate.graph : "v7"} ·
                prompt v12
              </footer>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      <ul className={s.legend} aria-hidden="true">
        {Object.entries(vendorLabels).map(([vendor, label]) => (
          <li key={vendor} data-vendor={vendor}>
            <i />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Leaderboard({
  scored,
  complete,
  hovered,
  onHover,
}: {
  scored: boolean;
  complete: boolean;
  hovered: string | null;
  onHover: (name: string | null) => void;
}) {
  return (
    <div className={`${s.card} ${s.boardCard}`}>
      <div className={s.cardHead}>
        <strong>Ranked by score</strong>
        <span>cost per case</span>
      </div>
      <ol className={s.board}>
        {ranked.map((candidate, index) => (
          <li
            key={candidate.name}
            data-vendor={candidate.vendor}
            data-show={scored ? "true" : "false"}
            data-hovered={hovered === candidate.name ? "true" : "false"}
            data-dimmed={
              hovered !== null && hovered !== candidate.name ? "true" : "false"
            }
            style={{ "--i": index } as CSSProperties}
            onMouseEnter={() => onHover(candidate.name)}
            onMouseLeave={() => onHover(null)}
          >
            <span className={s.rank}>{index + 1}</span>
            <span className={s.boardName}>
              <i aria-hidden="true" />
              <span>{candidate.name}</span>
              {"best" in candidate ? (
                <em
                  className={s.bestPill}
                  data-show={complete ? "true" : "false"}
                  aria-hidden={complete ? undefined : true}
                >
                  best value
                </em>
              ) : null}
            </span>
            <span className={s.boardScore}>{candidate.score}%</span>
            <span className={s.boardCost}>${candidate.cost.toFixed(3)}</span>
          </li>
        ))}
      </ol>
      {/* The point of the run: what each change did against the baseline. */}
      <div
        className={s.boardNote}
        data-show={complete ? "true" : "false"}
        aria-hidden={complete ? undefined : true}
      >
        <span className={s.paneLabel}>Against Sonnet 5 on graph v7</span>
        <dl>
          <dt>graph v8</dt>
          <dd data-tone="up">+3 pts</dd>
          <dd data-tone="up">−33% cost</dd>
          <dt>ra-sonnet-ft-v3</dt>
          <dd data-tone="down">−1 pt</dd>
          <dd data-tone="up">−71% cost</dd>
        </dl>
      </div>
    </div>
  );
}

const matrixColumns = [
  { label: "Sonnet 5", sub: "graph v7" },
  { label: "Sonnet 5", sub: "graph v8" },
  { label: "ft-v3", sub: "graph v7" },
  { label: "Haiku 4.5", sub: "graph v7" },
] as const;

// The first column is the baseline; a cell that differs from it is a change.
const matrixRows = [
  ["001", "Ambiguous retrieval", [true, true, true, false]],
  ["002", "Missing source citation", [true, true, true, false]],
  ["003", "Conflicting context", [false, true, false, false]],
  ["041", "Stale snapshot date", [true, true, true, true]],
  ["087", "Two papers, one name", [true, false, true, true]],
  ["128", "Grounding cites outside context", [false, true, true, false]],
] as const;

const passRates = ["93%", "96%", "92%", "86%"] as const;

// Counted from the rows above, so the summary can never disagree with them.
const changeCounts = matrixColumns.map((_, column) => {
  let fixed = 0;
  let regressed = 0;
  for (const [, , results] of matrixRows) {
    if (results[column] && !results[0]) fixed += 1;
    if (!results[column] && results[0]) regressed += 1;
  }
  return { fixed, regressed };
});

function CaseMatrix({ show }: { show: boolean }) {
  return (
    <div className={`${s.card} ${s.matrixCard}`}>
      <div className={s.cardHead}>
        <strong>Per-case results</strong>
        <span>against Sonnet 5 on graph v7</span>
      </div>
      <table className={s.matrix}>
        <thead>
          <tr>
            <th scope="col">Case</th>
            {matrixColumns.map((column) => (
              <th key={`${column.label}-${column.sub}`} scope="col">
                {column.label}
                <small>{column.sub}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrixRows.map(([id, name, results], row) => (
            <tr key={id}>
              <th scope="row">
                <span>{id}</span>
                {name}
              </th>
              {results.map((passed, column) => {
                const change =
                  column === 0 || passed === results[0]
                    ? undefined
                    : passed
                      ? "fixed"
                      : "regressed";
                return (
                  <td
                    key={column}
                    data-passed={passed ? "true" : "false"}
                    data-change={change}
                    data-show={show ? "true" : "false"}
                    style={{ "--i": row * 4 + column } as CSSProperties}
                    aria-label={`${passed ? "passed" : "failed"}${change ? `, ${change}` : ""}`}
                  >
                    {passed ? (
                      <CheckIcon size={10} weight="bold" aria-hidden="true" />
                    ) : (
                      <XIcon size={10} weight="bold" aria-hidden="true" />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Pass rate</th>
            {passRates.map((rate, index) => (
              <td key={index}>{rate}</td>
            ))}
          </tr>
          <tr>
            <th scope="row">Fixed · regressed</th>
            {changeCounts.map(({ fixed, regressed }, index) =>
              index === 0 ? (
                <td key={index}>
                  <span data-tone="none">baseline</span>
                </td>
              ) : (
                <td key={index}>
                  <span data-tone={fixed ? "up" : "none"}>+{fixed}</span>{" "}
                  <span data-tone={regressed ? "down" : "none"}>
                    −{regressed}
                  </span>
                </td>
              ),
            )}
          </tr>
        </tfoot>
      </table>
      <p className={s.matrixKey} aria-hidden="true">
        <span data-change="fixed">fixed</span>
        <span data-change="regressed">regressed</span>
        vs. the baseline
      </p>
    </div>
  );
}
