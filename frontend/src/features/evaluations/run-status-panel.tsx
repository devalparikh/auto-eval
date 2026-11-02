import { ArrowRightIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { systemPath } from "@/features/systems/system-path";
import { shortId } from "@/lib/format";
import type { EvalRun } from "@/lib/types";

export function RunStatusPanel({
  runs,
  graphNumbers,
  systemKey,
}: {
  runs: EvalRun[];
  graphNumbers: Map<string, number>;
  systemKey: string;
}) {
  if (!runs.length) return null;
  const finished = runs.every((run) =>
    ["complete", "failed"].includes(run.status),
  );
  const completed = runs.find((run) => run.status === "complete");

  return (
    <aside className="self-start overflow-hidden surface-card">
      {runs.map((run) => {
        const graphVersion = graphNumbers.get(run.agent_system_version_id);
        return (
          <section
            key={run.id}
            className="border-b border-[var(--border)] last:border-b-0"
          >
            <div className="flex items-center justify-between gap-3 px-4 pt-3">
              <h2 className="text-[12px] font-semibold">Run {shortId(run.id)}</h2>
              <StatusBadge status={run.status} />
            </div>
            <div className="grid gap-2 px-4 pt-2 pb-3 text-[11px]">
              {graphVersion !== undefined ? (
                <StatusRow label="Graph" value={`v${graphVersion}`} />
              ) : null}
              <StatusRow
                label="Models finished"
                value={`${run.results.length}/${run.model_ids.length}`}
              />
              {run.error ? (
                <p className="text-[var(--danger)]">{run.error}</p>
              ) : null}
            </div>
          </section>
        );
      })}
      {finished && completed ? (
        <div className="grid p-4">
          <Link
            href={`${systemPath(systemKey, "results")}?${new URLSearchParams({ dataset: completed.dataset_version_id })}`}
            className="app-button"
          >
            View results
            <ArrowRightIcon size={14} />
          </Link>
        </div>
      ) : null}
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
