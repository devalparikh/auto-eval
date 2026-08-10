const tones: Record<string, string> = {
  complete: "bg-[var(--success-soft)] text-[var(--success)]",
  final: "bg-[var(--success-soft)] text-[var(--success)]",
  running: "bg-[var(--accent-soft)] text-[var(--accent)]",
  queued: "bg-[var(--accent-soft)] text-[var(--accent)]",
  draft: "bg-[var(--warning-soft)] text-[var(--warning)]",
  failed: "bg-[var(--danger-soft)] text-[var(--danger)]",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex min-h-5 items-center rounded-[6px] px-2 text-[11px] font-semibold ${
        tones[status] ?? "bg-[var(--surface-muted)] text-[var(--text-muted)]"
      }`}
    >
      {status}
    </span>
  );
}
