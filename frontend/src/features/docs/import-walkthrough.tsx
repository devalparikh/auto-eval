"use client";

import {
  ArrowRightIcon,
  CheckIcon,
  FileCodeIcon,
  FolderIcon,
} from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useId, useState } from "react";
import styles from "./docs.module.css";

const steps = [
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

// The tab glide from x.ai/bot: leaves fast and settles softly.
const glide = { duration: 0.22, ease: [0.32, 0.72, 0, 1] } as const;

/** Four steps of an import, each with a small scene of what it produces. */
export function ImportWalkthrough() {
  const [step, setStep] = useState(0);
  const reduceMotion = useReducedMotion();
  const layoutId = `walkthrough:${useId()}`;
  const current = steps[step];

  return (
    <div className={styles.walkthrough}>
      <div
        className={styles.walkSteps}
        role="group"
        aria-label="Import walkthrough"
      >
        {steps.map((item, index) => (
          <button
            type="button"
            key={item.title}
            aria-pressed={step === index}
            aria-controls="import-walkthrough-scene"
            onClick={() => setStep(index)}
          >
            {step === index ? (
              <motion.span
                className={styles.walkPill}
                layoutId={reduceMotion ? undefined : layoutId}
                transition={glide}
                style={{ borderRadius: 14 }}
                aria-hidden="true"
              />
            ) : null}
            <span className={styles.walkIndex}>0{index + 1}</span>
            <span className={styles.walkCopy}>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </span>
          </button>
        ))}
      </div>
      <div
        className={styles.scene}
        id="import-walkthrough-scene"
        role="region"
        aria-label={current.title}
      >
        <div className={styles.sceneChrome}>
          <span>{current.filename}</span>
          <span>
            {step + 1} / {steps.length}
          </span>
        </div>
        <motion.div
          key={step}
          className={styles.sceneBody}
          initial={
            reduceMotion ? false : { opacity: 0.3, y: 6, filter: "blur(3px)" }
          }
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{
            duration: reduceMotion ? 0 : 0.28,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <Scene step={step} />
        </motion.div>
      </div>
    </div>
  );
}

function Scene({ step }: { step: number }) {
  if (step === 0) {
    return (
      <>
        <div className={styles.fileTree}>
          <span>
            <FolderIcon size={16} aria-hidden="true" />
            support-summary/
          </span>
          <span>
            <FileCodeIcon size={14} aria-hidden="true" />
            agent.py
          </span>
          <span>
            <FileCodeIcon size={14} aria-hidden="true" />
            tests/
          </span>
          <span>
            <FileCodeIcon size={14} aria-hidden="true" />
            autoeval.json
          </span>
        </div>
        <p>
          The manifest holds a stable key, a sample input, a graph, and its
          prompt. The import reads this file and nothing else.
        </p>
      </>
    );
  }
  if (step === 1) {
    return (
      <>
        <div
          className={styles.miniGraph}
          role="img"
          aria-label="Read request, then summarize with a model, then return the summary"
        >
          <div className={styles.miniNode}>
            <small>deterministic</small>
            <strong>Read request</strong>
          </div>
          <ArrowRightIcon size={14} aria-hidden="true" />
          <div className={styles.miniNode} data-kind="llm">
            <small>model</small>
            <strong>Summarize</strong>
          </div>
          <ArrowRightIcon size={14} aria-hidden="true" />
          <div className={styles.miniNode}>
            <small>deterministic</small>
            <strong>Return summary</strong>
          </div>
        </div>
        <p>
          Every node names a handler, and edges set the order. The model is
          chosen when you run, so one graph can compare local and hosted models.
        </p>
      </>
    );
  }
  if (step === 2) {
    return (
      <>
        <h3>Support summary</h3>
        <div>
          <div className={styles.pinRow}>
            <CheckIcon size={15} aria-hidden="true" />
            <span>Graph and handlers valid</span>
            <code>3 nodes</code>
          </div>
          <div className={styles.pinRow}>
            <CheckIcon size={15} aria-hidden="true" />
            <span>Prompt captured</span>
            <code>v1</code>
          </div>
          <div className={styles.pinRow}>
            <CheckIcon size={15} aria-hidden="true" />
            <span>Draft dataset created on import</span>
            <code>0 examples</code>
          </div>
        </div>
        <p>
          The preview changes nothing. Importing saves the validated manifest
          and its immutable versions together.
        </p>
      </>
    );
  }
  return (
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
        Old traces still point to v1. Run the same finalized dataset against v2
        to measure the change.
      </p>
    </>
  );
}
