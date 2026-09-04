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
      className={`inline-flex min-h-[19px] items-center gap-1 rounded-full px-2 text-[11px] font-medium tracking-[-0.1px] ${
        tones[status] ?? "bg-[var(--surface-muted)] text-[var(--text-muted)]"
      }`}
    >
      <span className="status-dot" aria-hidden="true" />
      {status}
    </span>
  );
}
