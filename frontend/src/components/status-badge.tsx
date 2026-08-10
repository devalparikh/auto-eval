const tones: Record<string, string> = {
  complete: "bg-[var(--success-soft)] text-[var(--success)]",
  final: "bg-[var(--success-soft)] text-[var(--success)]",
  running: "status-running bg-[var(--accent-soft)] text-[var(--accent)]",
  queued: "status-running bg-[var(--accent-soft)] text-[var(--accent)]",
  draft: "bg-[var(--warning-soft)] text-[var(--warning)]",
  failed: "bg-[var(--danger-soft)] text-[var(--danger)]",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`mono inline-flex min-h-5 items-center gap-1.5 rounded-[2px] border border-current/15 px-1.5 text-[9px] font-medium ${
        tones[status] ?? "bg-[var(--surface-muted)] text-[var(--text-muted)]"
      }`}
    >
      <span className="status-dot" aria-hidden="true" />
      {status}
    </span>
  );
}
