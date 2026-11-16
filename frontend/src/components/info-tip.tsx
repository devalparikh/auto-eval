"use client";

import { InfoIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import styles from "./info-tip.module.css";

/**
 * Guidance that matters but need not be read every time: an info button that
 * opens a short note on hover, focus, or tap. Escape and a tap elsewhere
 * close it, so it works inside a modal and on touch screens.
 *
 * `align` names the edge the note lines up with: "end" opens leftward from a
 * button at the right of a row, "start" rightward from one beside a label.
 */
export function InfoTip({
  label,
  children,
  align = "end",
  className = "",
}: {
  /** The button's accessible name, e.g. "Key lifespan details". */
  label: string;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Dismiss the note before any surrounding modal.
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
    }
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", dismiss, true);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", dismiss, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  return (
    <span
      ref={root}
      className={`${styles.root} ${className}`.trim()}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!root.current?.contains(document.activeElement)) setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className={styles.button}
        aria-label={label}
        aria-describedby={id}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
      >
        <InfoIcon size={15} aria-hidden="true" />
      </button>
      <span id={id} role="tooltip" hidden={!open} className={styles.tip} data-align={align}>
        <span>{children}</span>
      </span>
    </span>
  );
}
