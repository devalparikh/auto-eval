"use client";

import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useState } from "react";
import styles from "./docs.module.css";

/**
 * Copyable source. A long block can start folded behind `collapsedLabel`; its
 * copy button still copies the whole text.
 */
export function CodeBlock({
  title,
  code,
  collapsedLabel,
}: {
  title: string;
  code: string;
  collapsedLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setFailed(false);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setFailed(true);
    }
  }

  const source = (
    <pre tabIndex={0}>
      <code>{code}</code>
    </pre>
  );

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHead}>
        <span>{title}</span>
        <button
          type="button"
          className={styles.copy}
          data-copied={copied}
          aria-label={`Copy ${title}`}
          onClick={copy}
        >
          {copied ? (
            <CheckIcon size={12} weight="bold" aria-hidden="true" />
          ) : (
            <CopyIcon size={12} aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {collapsedLabel ? (
        <details className={styles.codeDetails}>
          <summary>{collapsedLabel}</summary>
          {source}
        </details>
      ) : (
        source
      )}
      {failed ? (
        <p role="alert" className={styles.codeNote}>
          Clipboard unavailable. Select the text to copy it.
        </p>
      ) : null}
    </div>
  );
}
