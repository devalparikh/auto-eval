"use client";

import {
  CheckIcon,
  EyeSlashIcon,
  FloppyDiskIcon,
  KeyIcon,
  LockSimpleIcon,
  ProhibitIcon,
} from "@phosphor-icons/react";
import { useRef, type CSSProperties, type ReactNode } from "react";

import {
  useCycle,
  useSceneActive,
  useTimer,
} from "@/features/landing/landing-motion";
import styles from "@/features/landing/landing.module.css";

/*
 * Product moments rendered inside the feature cards. Each one loops through a
 * few timed beats while it is on screen: status badges crossfade, scenes
 * crossfade, entries pop in with a slight overshoot, and pill rows morph open
 * one label at a time.
 */

type Tone = "warning" | "success" | "info" | "danger" | "neutral";

export function Badge({
  tone,
  spinning = false,
  children,
}: {
  tone: Tone;
  spinning?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={styles.badge} data-tone={tone}>
      {spinning ? (
        <i className={styles.badgeSpinner} aria-hidden="true" />
      ) : (
        <i className={styles.badgeDot} aria-hidden="true" />
      )}
      {children}
    </span>
  );
}

/** Two badges stacked in the same cell; the inactive one fades out. */
export function BadgeSwap({
  active,
  items,
}: {
  active: number;
  items: ReactNode[];
}) {
  return (
    <span className={styles.badgeSwap}>
      {items.map((item, index) => (
        <span key={index} data-hidden={index === active ? "false" : "true"}>
          {item}
        </span>
      ))}
    </span>
  );
}

function Panel({
  title,
  badge,
  note,
  children,
}: {
  title: string;
  badge?: ReactNode;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <strong>{title}</strong>
        <span />
        {badge}
      </div>
      {note ? <p>{note}</p> : null}
      {children}
    </div>
  );
}

export function Cursor({
  label,
  x,
  y,
  show,
}: {
  label: string;
  x: number;
  y: number;
  show: boolean;
}) {
  return (
    <div
      className={styles.cursor}
      data-show={show ? "true" : "false"}
      style={{ left: `${x}%`, top: `${y}%` }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 16 16" width="14" height="14">
        <path
          d="M3 2l9 6.2-4.1.8L9.8 13 8 13.8 6.2 9.6 3 12z"
          fill="#111"
          stroke="#fff"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      <span>{label}</span>
    </div>
  );
}

/* Card 1: the manifest is read, then the contract is registered. */
export function ManifestVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const { active, reduceMotion } = useSceneActive(ref);
  const phase = useCycle([2400, 3000, 1400], active);
  const registered = reduceMotion || phase >= 1;
  const contract = ["graph", "handlers", "scoring", "trace policy"];

  return (
    <div ref={ref} className={styles.stage} aria-hidden="true">
      <Panel
        title="Code adapter"
        badge={
          <BadgeSwap
            active={registered ? 1 : 0}
            items={[
              <Badge key="reading" tone="warning" spinning>
                Reading plugin.py
              </Badge>,
              <Badge key="ok" tone="success">
                Registered
              </Badge>,
            ]}
          />
        }
        note="Register research-assistant so AutoEval can run it."
      >
        <div className={styles.editor}>
          <div className={styles.editorBar}>
            <i />
            <i />
            <i />
            <span>plugin.py</span>
          </div>
          <pre>
            <span>
              <b>1</b>
              <i>system_key</i> = &quot;research-assistant&quot;
            </span>
            <span>
              <b>2</b>
              <i>default_model</i> = &quot;candidate-a&quot;
            </span>
            <span>
              <b>3</b>
              <i>register_handlers</i>(registry)
            </span>
            <span data-typing={phase === 0 && !reduceMotion ? "true" : "false"}>
              <b>4</b>
              <i>scoring_entries</i> = [grounding, citation_format]
            </span>
          </pre>
        </div>
        <ul
          className={styles.contractRows}
          data-show={registered ? "true" : "false"}
        >
          {contract.map((item, index) => (
            <li
              key={item}
              style={{ "--i": index } as CSSProperties}
              className={registered ? styles.rowEnter : undefined}
            >
              <span>{item}</span>
              <em>found in package</em>
              <b className={registered ? styles.checkPop : undefined}>
                <CheckIcon size={11} weight="bold" />
              </b>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

/* Card 2: a run moves through the graph while a recording timer counts. */
const graphNodes = [
  { x: 10, y: 48, w: 74, kind: "input", name: "question" },
  { x: 132, y: 14, w: 70, kind: "live", name: "retrieve" },
  { x: 132, y: 82, w: 70, kind: "model", name: "generate" },
  { x: 250, y: 48, w: 66, kind: "check", name: "grounding" },
] as const;

const graphEdges = [
  "M84 66 C 108 66, 110 32, 132 32",
  "M84 66 C 108 66, 110 100, 132 100",
  "M202 32 C 226 32, 228 66, 250 66",
  "M202 100 C 226 100, 228 66, 250 66",
];

const cursorStops = [
  { x: 24, y: 58 },
  { x: 46, y: 26 },
  { x: 50, y: 74 },
  { x: 80, y: 56 },
];

export function GraphVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const { active, reduceMotion } = useSceneActive(ref);
  const phase = useCycle([1500, 1600, 1600, 2000], active);
  const timer = useTimer(active);
  const done = reduceMotion ? 4 : phase;
  const statusOf = (index: number) =>
    index < done ? "complete" : index === done ? "running" : "pending";

  return (
    <div ref={ref} className={styles.stage} aria-hidden="true">
      <div className={styles.recordingBar}>
        <span className={styles.recordingLabel}>
          <b>research-assistant</b> is running tr_01J8F2KQ
        </span>
        <span className={styles.recordingTimer}>
          <i />
          {timer}
        </span>
        <span
          className={styles.recordingPill}
          data-pressed={phase < 3 ? "true" : "false"}
        >
          <i />
          Run graph
        </span>
      </div>
      <div className={`${styles.screen} ${styles.screenLake}`}>
        <div className={styles.window}>
          <div className={styles.windowBar}>
            <i />
            <i />
            <i />
          </div>
          <svg viewBox="0 0 326 132" className={styles.graphSvg}>
            {graphEdges.map((d, index) => (
              <path
                key={d}
                className={styles.graphEdge}
                d={d}
                data-active={index < 2 ? done >= 1 : done >= 3}
              />
            ))}
            {graphNodes.map((node, index) => (
              <g
                key={node.name}
                className={styles.graphNode}
                data-kind={node.kind}
                data-status={statusOf(index)}
              >
                <rect x={node.x} y={node.y} width={node.w} height="36" rx="6" />
                <rect
                  x={node.x}
                  y={node.y + 7}
                  width="2"
                  height="22"
                  className={styles.graphNodeBar}
                />
                <text
                  x={node.x + 10}
                  y={node.y + 14}
                  className={styles.graphNodeKind}
                >
                  {node.kind}
                </text>
                <text
                  x={node.x + 10}
                  y={node.y + 27}
                  className={styles.graphNodeName}
                >
                  {node.name}
                </text>
                <circle
                  cx={node.x + node.w - 8}
                  cy={node.y + 9}
                  r="2.4"
                  className={styles.graphNodeDot}
                />
              </g>
            ))}
            {!reduceMotion ? (
              <circle className={styles.graphPulse} r="2.6">
                <animateMotion
                  dur="2.4s"
                  repeatCount="indefinite"
                  path="M84 66 C 108 66, 110 32, 132 32 L 202 32 C 226 32, 228 66, 250 66"
                />
              </circle>
            ) : null}
          </svg>
        </div>
        <Cursor
          label="You"
          show={!reduceMotion}
          {...cursorStops[Math.min(phase, 3)]}
        />
      </div>
    </div>
  );
}

/* Card 3: scoring results arrive as a transcript, then credit your package. */
export function HandlersVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const { active, reduceMotion } = useSceneActive(ref);
  const phase = useCycle([1400, 1500, 1700, 2000], active);
  const shown = reduceMotion ? 3 : phase;

  return (
    <div
      ref={ref}
      className={`${styles.stage} ${styles.transcript}`}
      aria-hidden="true"
    >
      <div className={styles.transcriptInner}>
        <div className={styles.bubble} key={`first-${shown === 0}`}>
          grounding scored <b>0.92</b>. Every cited source was present in the
          retrieved context.
        </div>
        {shown >= 1 ? (
          <div className={styles.bubble}>
            citation_format scored <b>1.0</b>. Four citations, all in the
            expected shape.
          </div>
        ) : null}
        {shown >= 2 ? (
          <div className={styles.systemLine}>
            Scored by
            <span className={styles.systemPill}>
              <i />
              research-assistant/scoring.py
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* Card 4: the trace policy applies one rule at a time. */
const policyPills = [
  { icon: EyeSlashIcon, label: "Redacting inputs…", tone: "cyan" },
  { icon: FloppyDiskIcon, label: "Persisting outputs…", tone: "violet" },
  { icon: KeyIcon, label: "Keeping keys local…", tone: "red" },
  { icon: ProhibitIcon, label: "Blocking egress…", tone: "yellow" },
] as const;

export function PolicyVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const { active } = useSceneActive(ref);
  const phase = useCycle([1500, 1500, 1500, 1500], active);

  return (
    <div
      ref={ref}
      className={`${styles.stage} ${styles.pillStage}`}
      aria-hidden="true"
    >
      <ul className={styles.pillRow}>
        {policyPills.map((pill, index) => {
          const Icon = pill.icon;
          return (
            <li
              key={pill.label}
              className={styles.pill}
              data-tone={pill.tone}
              data-open={index === phase ? "true" : "false"}
            >
              <span className={styles.pillChip}>
                <Icon size={12} weight="bold" />
              </span>
              <span className={styles.pillSpread}>
                <span className={styles.pillLabel}>{pill.label}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* Provenance moments: compact panels with the same vocabulary. */

export function HashVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const { active, reduceMotion } = useSceneActive(ref);
  const phase = useCycle([1600, 2600], active);
  const resolved = reduceMotion || phase === 1;

  return (
    <div ref={ref} className={styles.stage} aria-hidden="true">
      <Panel
        title="Versions"
        badge={
          <BadgeSwap
            active={resolved ? 1 : 0}
            items={[
              <Badge key="hashing" tone="warning" spinning>
                Hashing
              </Badge>,
              <Badge key="ok" tone="success">
                Resolved
              </Badge>,
            ]}
          />
        }
      >
        <ul className={styles.hashRows}>
          {[
            ["graph v7", "c94b 71e0 … 8fa1"],
            ["prompt v12", "0a3d 9c44 … 2b7e"],
          ].map(([name, hash], index) => (
            <li key={name} style={{ "--i": index } as CSSProperties}>
              <span>{name}</span>
              <code>{hash}</code>
              <b
                className={resolved ? styles.checkPop : undefined}
                data-show={resolved ? "true" : "false"}
              >
                <CheckIcon size={10} weight="bold" />
              </b>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

export function LockVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const { active, reduceMotion } = useSceneActive(ref);
  const phase = useCycle([1800, 2600], active);
  const locked = reduceMotion || phase === 1;

  return (
    <div ref={ref} className={styles.stage} aria-hidden="true">
      <Panel
        title="Dataset"
        badge={
          <BadgeSwap
            active={locked ? 1 : 0}
            items={[
              <Badge key="draft" tone="warning">
                Draft v4
              </Badge>,
              <Badge key="final" tone="success">
                Finalized v4
              </Badge>,
            ]}
          />
        }
        note="failure-modes · 128 reviewed cases"
      >
        <div className={styles.lockRow} data-locked={locked ? "true" : "false"}>
          <span className={styles.lockIcon}>
            <LockSimpleIcon size={13} weight="fill" />
          </span>
          <span>
            {locked ? "Immutable. Ready to evaluate." : "Finalizing…"}
          </span>
        </div>
      </Panel>
    </div>
  );
}

export function SnapshotVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const { active, reduceMotion } = useSceneActive(ref);
  const phase = useCycle([1500, 1500, 2600], active);
  const shown = reduceMotion ? 2 : phase;
  const sources = [
    ["quotes", "09:14:02"],
    ["documents", "09:14:02"],
  ] as const;

  return (
    <div ref={ref} className={styles.stage} aria-hidden="true">
      <Panel
        title="Snapshots"
        badge={
          <BadgeSwap
            active={shown >= 1 ? 1 : 0}
            items={[
              <Badge key="capturing" tone="warning" spinning>
                Capturing
              </Badge>,
              <Badge key="frozen" tone="info">
                Frozen with case 017
              </Badge>,
            ]}
          />
        }
      >
        <ul className={styles.snapshotRows}>
          {sources.map(([name, time], index) => (
            <li
              key={name}
              className={styles.rowEnter}
              style={{ "--i": index } as CSSProperties}
            >
              <span>{time}</span>
              <b>{name}</b>
              <em>{shown >= 1 ? "frozen" : "live"}</em>
            </li>
          ))}
          {shown >= 2 ? (
            <li className={styles.rowEnter} data-replay="true">
              <span>+30 d</span>
              <b>eval 024</b>
              <em>identical</em>
            </li>
          ) : null}
        </ul>
      </Panel>
    </div>
  );
}

export function KeysVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const { active, reduceMotion } = useSceneActive(ref);
  const phase = useCycle([1800, 2400], active);
  const checked = reduceMotion || phase === 1;

  return (
    <div ref={ref} className={styles.stage} aria-hidden="true">
      <Panel
        title="Environment"
        badge={
          <BadgeSwap
            active={checked ? 1 : 0}
            items={[
              <Badge key="check" tone="warning" spinning>
                Checking
              </Badge>,
              <Badge key="ok" tone="success">
                Server only
              </Badge>,
            ]}
          />
        }
      >
        <ul className={styles.envRows}>
          <li>
            <i>OPENROUTER_API_KEY</i>
            <span>••••••••</span>
          </li>
          <li>
            <i>AUTOEVAL_ENV</i>
            <span>local</span>
          </li>
          <li data-blocked={checked ? "true" : "false"}>
            <i>NEXT_PUBLIC_*</i>
            <span>never a secret</span>
          </li>
        </ul>
      </Panel>
    </div>
  );
}
