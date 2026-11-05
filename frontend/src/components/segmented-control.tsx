"use client";

import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

// The tab glide from x.ai/bot, measured from its source: a short duration on a
// curve that leaves fast and settles softly, so the pill arrives rather than
// slides.
const glide = { duration: 0.22, ease: [0.32, 0.72, 0, 1] } as const;

/**
 * Mutually exclusive options with one pill that glides to the active one. The
 * pill moves on a shared layout animation, so switching reads as one motion
 * instead of a background fading out in one place and in at another.
 *
 * The options are toggle buttons (`aria-pressed`) rather than tabs: they filter
 * or re-render the content beside them instead of owning separate panels.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
  className = "",
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  "aria-label": string;
  className?: string;
}) {
  const id = useId();
  const reduceMotion = useReducedMotion();
  // useId is positional, so two screens can mint the same id. The label keeps a
  // pill from gliding in from a different control on the previous screen.
  const layoutId = reduceMotion ? undefined : `segmented:${ariaLabel}:${id}`;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`segmented ${className}`.trim()}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={option.disabled}
            onClick={() => {
              if (!active) onChange(option.value);
            }}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                className="segmented-pill"
                // Set inline so the layout animation can correct the radius
                // while the pill scales between options of different widths.
                style={{ borderRadius: 999 }}
                transition={glide}
                aria-hidden="true"
              />
            ) : null}
            <span className="segmented-label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
