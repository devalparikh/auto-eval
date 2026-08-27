import { ArrowRightIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { systemPath } from "@/features/systems/system-path";
import { formatDate, shortId } from "@/lib/format";
import type { EvalRun } from "@/lib/types";

export function RunStatusPanel({
  run,
  systemKey,
}: {
  run: EvalRun | null;
  systemKey: string;
}) {
  if (!run) {
    return (
      <aside className="rounded-[var(--radius)] border border-dashed border-[var(--border-strong)] p-5">
        <h2 className="text-[13px] font-semibold">Run status</h2>
        <p className="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">
          Start an evaluation to follow its progress and compare the models.
        </p>
      </aside>
    );
  }

  return (
    <aside className="self-start overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-[12px] font-semibold">Run {shortId(run.id)}</h2>
        <StatusBadge status={run.status} />
      </div>
      <div className="grid gap-3 p-4 text-[11px]">
        <StatusRow label="Models" value={`${run.model_ids.length}`} />
        <StatusRow label="Started" value={formatDate(run.created_at)} />
        <StatusRow
          label="Completed results"
          value={`${run.results.length}/${run.model_ids.length}`}
        />
        {run.error ? <p className="text-[var(--danger)]">{run.error}</p> : null}
        {run.status === "complete" ? (
          <Link href={systemPath(systemKey, "results")} className="app-button mt-2">
            View results
            <ArrowRightIcon size={14} />
          </Link>
        ) : (
          <p className="mt-2 text-[10px] text-[var(--text-muted)]">
            Results appear here as each model completes.
          </p>
        )}
      </div>
    </aside>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="mono font-medium">{value}</span>
    </div>
  );
}
