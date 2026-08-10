import { WarningCircleIcon } from "@phosphor-icons/react";

export function LoadingState({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-label="Loading" className="space-y-2 p-5">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton h-11 w-full" />
      ))}
    </div>
  );
}
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="m-5 flex items-start gap-3 rounded-[var(--radius)] border border-[var(--danger)]/30 bg-[var(--danger-soft)] p-4 text-[var(--danger)]">
      <WarningCircleIcon className="mt-0.5 shrink-0" size={18} weight="fill" />
      <div className="min-w-0">
        <p className="font-semibold">Could not load this view</p>
        <p className="mt-1 text-[12px]">{message}</p>
        {retry ? (
          <button className="mt-3 text-[12px] font-semibold underline" onClick={retry}>
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="grid min-h-64 place-items-center px-5 text-center">
      <div>
        <div
          className="mono mx-auto mb-4 grid size-10 place-items-center border border-dashed border-[var(--border-strong)] text-[11px] text-[var(--accent)]"
          aria-hidden="true"
        >
          ::
        </div>
        <p className="font-semibold tracking-[-0.02em]">{title}</p>
        <p className="mt-1.5 max-w-sm text-[11px] leading-5 text-[var(--text-muted)]">
          {message}
        </p>
      </div>
    </div>
  );
}
