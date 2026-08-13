import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { systemPath } from "@/features/systems/system-path";
import { shortId } from "@/lib/format";
import type { NodeResourceSelection } from "@/lib/types";

export function ResourceSnapshotRefs({
  systemKey,
  bindings,
}: {
  systemKey: string;
  bindings: Record<string, NodeResourceSelection> | undefined;
}) {
  const entries = Object.entries(bindings ?? {});
  if (entries.length === 0) return null;
  return (
    <div className="grid gap-2">
      {entries.map(([nodeId, selection]) => (
        <div
          key={`${nodeId}-${selection.mode === "locked" ? selection.snapshot_id : selection.identity}`}
          className="flex min-w-0 items-center justify-between gap-3 text-[10px]"
        >
          <span className="mono min-w-0 truncate text-[var(--text-muted)]">
            {nodeId} →{" "}
            {selection.mode === "locked"
              ? shortId(selection.snapshot_id)
              : `current · ${selection.identity}`}
          </span>
          {selection.mode === "locked" ? (
            <Link
              href={`${systemPath(systemKey, "artifacts")}?snapshot=${encodeURIComponent(selection.snapshot_id)}`}
              className="flex shrink-0 items-center gap-1 text-[var(--accent)] hover:underline"
            >
              Open resource
              <ArrowSquareOutIcon size={11} />
            </Link>
          ) : (
            <span className="shrink-0 text-[9px] text-[var(--text-faint)]">
              resolves at run start
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
