import { CloudArrowDownIcon, LockKeyIcon } from "@phosphor-icons/react";
import type { GraphDefinition } from "@/lib/types";

export function RuntimeInputNotice({
  definition,
  context,
}: {
  definition: GraphDefinition | null;
  context: "run" | "evaluation";
}) {
  const nodes = (definition?.nodes ?? []).filter(
    (node) => node.runtime_input_policy,
  );
  if (nodes.length === 0) return null;
  const Icon = context === "run" ? CloudArrowDownIcon : LockKeyIcon;
  return (
    <div className="flex items-start gap-3 border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-3">
      <Icon
        size={15}
        className="mt-0.5 shrink-0 text-[var(--accent)]"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="text-[11px] font-medium">
          {context === "run" ? "Live data in this run" : "Live data in evaluations"}
        </p>
        <p className="mt-1 text-[10px] leading-5 text-[var(--text-muted)]">
          {context === "run"
            ? "These nodes fetch data from outside the app while the run happens."
            : "Every example uses the exact snapshot pinned to it, so scores stay comparable across runs."}
        </p>
        <div className="mt-2 grid gap-1 text-[9px] text-[var(--text-faint)]">
          {nodes.map((node) => {
            const policy = node.runtime_input_policy!;
            const mode =
              context === "run" ? policy.runtime_mode : policy.evaluation_mode;
            return (
              <span key={node.id}>
                {node.label} — {modeLine(context, mode)}
                {!policy.required ? " Optional." : ""}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function modeLine(
  context: "run" | "evaluation",
  mode: "locked" | "refresh",
): string {
  if (mode === "refresh") return "Fetches new data.";
  return context === "run"
    ? "Reuses the last saved copy."
    : "Uses the snapshot pinned to each example.";
}
