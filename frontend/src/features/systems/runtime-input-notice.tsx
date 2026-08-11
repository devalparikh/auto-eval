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
          {context === "run"
            ? "Direct run external inputs"
            : "Evaluation observation bindings"}
        </p>
        <p className="mt-1 text-[10px] leading-5 text-[var(--text-muted)]">
          {context === "run"
            ? "External observations refresh when these graph nodes execute. Saved input samples contain business input only; they never capture runtime observations."
            : "Each dataset example supplies locked observation references. Evaluations do not refresh them, so every model sees the same recorded external data."}
        </p>
        <div className="mono mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-[var(--text-faint)]">
          {nodes.map((node) => {
            const policy = node.runtime_input_policy!;
            const mode =
              context === "run" ? policy.runtime_mode : policy.evaluation_mode;
            return (
              <span key={node.id}>
                {node.label} · {policy.source} · {context} {mode}
                {policy.schema_version
                  ? ` · schema v${policy.schema_version}`
                  : ""}
                {!policy.required ? " · conditional" : ""}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
