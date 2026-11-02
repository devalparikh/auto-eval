"use client";

import { InfoIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./custom-models.module.css";

export function BaseModelInfo() {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Dismiss the tooltip before the surrounding modal.
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
      className={styles.modelInfo}
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
        className={styles.infoButton}
        aria-label="Base model requirements"
        aria-describedby={id}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
      >
        <InfoIcon size={16} aria-hidden="true" />
      </button>
      <span id={id} role="tooltip" hidden={!open} className={styles.modelTooltip}>
        <span>
          Local training requires an MLX-compatible text model with a chat
          template. Custom model compatibility is checked when training starts.
          Weights download on first training; check the model’s license and
          memory requirements.
        </span>
      </span>
    </span>
  );
}
