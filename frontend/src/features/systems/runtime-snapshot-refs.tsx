import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { systemPath } from "@/features/systems/system-path";
import { shortId } from "@/lib/format";

export function RuntimeSnapshotRefs({
  systemKey,
  bindings,
}: {
  systemKey: string;
  bindings: Record<string, string> | undefined;
}) {
  const entries = Object.entries(bindings ?? {});
  if (entries.length === 0) return null;
  return (
    <div className="grid gap-2">
      {entries.map(([nodeId, snapshotId]) => (
        <div
          key={`${nodeId}-${snapshotId}`}
          className="flex min-w-0 items-center justify-between gap-3 text-[10px]"
        >
          <span className="mono min-w-0 truncate text-[var(--text-muted)]">
            {nodeId} → {shortId(snapshotId)}
          </span>
          <Link
            href={`${systemPath(systemKey, "artifacts")}?snapshot=${encodeURIComponent(snapshotId)}`}
            className="flex shrink-0 items-center gap-1 text-[var(--accent)] hover:underline"
          >
            Open snapshot
            <ArrowSquareOutIcon size={11} />
          </Link>
        </div>
      ))}
    </div>
  );
}
