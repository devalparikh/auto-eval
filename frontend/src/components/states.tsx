import { ArrowClockwiseIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

export function LoadingState({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-label="Loading" className="loading-state space-y-2 p-5">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton h-11 w-full" />
      ))}
    </div>
  );
}

/**
 * A failure in place of the content it stopped. Flat like every other panel,
 * with the danger tone on the icon alone, so a view that failed to load reads
 * as information rather than an alarm. (An error that blocks a form action in
 * front of the user is tinted instead.) `className` replaces the default
 * margin when the container already spaces its children.
 */
export function ErrorState({
  title = "Could not load this view",
  message,
  retry,
  className = "m-5",
}: {
  title?: string;
  message: string;
  retry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={`${className} flex min-w-0 items-start gap-3 rounded-[var(--radius-inset)] bg-[var(--card-inset)] p-4`}
    >
      <span
        className="grid size-7 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-[var(--danger)]"
        aria-hidden="true"
      >
        <WarningCircleIcon size={15} weight="fill" />
      </span>
      <div className="min-w-0 pt-[3px]">
        <p className="text-[13px] font-medium leading-5 tracking-[-0.01em]">
          {title}
        </p>
        <p className="mt-0.5 max-w-[68ch] text-[12px] leading-5 text-[var(--text-muted)] [overflow-wrap:anywhere]">
          {message}
        </p>
        {retry ? (
          <button
            type="button"
            className="app-button secondary mt-3 !min-h-[30px] !px-3"
            onClick={retry}
          >
            <ArrowClockwiseIcon size={13} aria-hidden="true" />
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  /** The next step, when there is one to take from here. */
  action?: ReactNode;
}) {
  return (
    <div className="grid min-h-64 place-items-center px-5 text-center">
      <div className="grid justify-items-center">
        <div
          className="mono mb-4 grid size-10 place-items-center rounded-[12px] bg-[var(--card-inset)] text-[11px] text-[var(--text-faint)]"
          aria-hidden="true"
        >
          ::
        </div>
        <p className="font-medium tracking-[-0.02em]">{title}</p>
        <p className="mt-1.5 max-w-sm text-[12px] leading-5 text-[var(--text-muted)]">
          {message}
        </p>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  );
}
