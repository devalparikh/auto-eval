"use client";

export type RunPlanItem = {
  /** The node this choice belongs to, so a reader can jump straight to it. */
  nodeId: string;
  label: string;
  value: string;
  unset?: boolean;
};

/**
 * Everything a run reads that is chosen on a node rather than at the top of the
 * page, listed so the reader never has to click a node to learn what runs.
 */
export function RunPlanSummary({
  items,
  warnings,
  loading,
  onSelectNode,
}: {
  items: RunPlanItem[];
  warnings: string[];
  loading: boolean;
  onSelectNode: (nodeId: string) => void;
}) {
  if (!items.length) return null;

  return (
    <section
      className="border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-3"
      aria-labelledby="run-plan-summary-title"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="run-plan-summary-title" className="text-[11px] font-semibold">
          What this run uses
        </h3>
        <p className="text-[10px] text-[var(--text-muted)]">
          Select one to open its node in the graph below and change it.
        </p>
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={`${item.nodeId}-${item.label}`}>
            <button
              type="button"
              className="flex items-center gap-2 border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-left hover:border-[var(--border-strong)]"
              onClick={() => onSelectNode(item.nodeId)}
            >
              <span className="text-[9px] text-[var(--text-faint)]">
                {item.label}
              </span>
              <span
                className={`text-[10px] font-medium ${
                  item.unset ? "text-[var(--warning)]" : ""
                }`}
              >
                {loading && item.unset ? "Loading…" : item.value}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!loading && warnings.length ? (
        <div className="mt-2 grid gap-1">
          {warnings.map((warning) => (
            <p key={warning} className="text-[10px] text-[var(--warning)]">
              {warning}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
