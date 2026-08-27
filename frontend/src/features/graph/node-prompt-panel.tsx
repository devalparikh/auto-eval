"use client";

import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { Select } from "@/components/select";
import { systemPath } from "@/features/systems/system-path";
import { api } from "@/lib/api";
import type { PromptSummary } from "@/lib/types";
import { useApiResource } from "@/lib/use-api-resource";

/**
 * The prompt a model node runs, shown inside that node's details panel.
 *
 * Read-only wherever the graph is being inspected; pass `onSelectVersion` on
 * the run screen, where the version is part of what the run executes.
 */
export function GraphNodePromptPanel({
  systemKey,
  promptKey,
  prompt,
  selectedVersionId,
  onSelectVersion,
  disabled = false,
}: {
  systemKey: string;
  promptKey: string;
  prompt: PromptSummary | undefined;
  selectedVersionId?: string;
  onSelectVersion?: (versionId: string) => void;
  disabled?: boolean;
}) {
  const versions = prompt?.versions ?? [];
  const versionId =
    versions.find((version) => version.id === selectedVersionId)?.id ??
    versions[0]?.id ??
    "";
  const detail = useApiResource(
    () =>
      versionId
        ? api.promptVersion(versionId)
        : Promise.reject(new Error("No prompt version")),
    [versionId],
  );
  const version = versions.find((candidate) => candidate.id === versionId);

  if (!prompt) {
    return (
      <div className="px-4 py-3">
        <p className="text-[10px] leading-5 text-[var(--danger)]">
          This node needs the {promptKey} prompt, and this system does not have
          one yet.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-2.5 px-4 py-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium">{prompt.name}</p>
          <p className="mono mt-0.5 truncate text-[9px] text-[var(--text-faint)]">
            {prompt.key}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onSelectVersion ? (
            <Select
              aria-label={`Prompt version for ${prompt.name}`}
              containerClassName="version-select"
              value={versionId}
              disabled={disabled || !versions.length}
              onChange={(event) => onSelectVersion(event.target.value)}
            >
              {versions.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  Version {candidate.version}
                </option>
              ))}
            </Select>
          ) : (
            <span className="mono text-[9px] text-[var(--text-faint)]">
              v{version?.version ?? "-"}
            </span>
          )}
          <Link
            href={`${systemPath(systemKey, "artifacts")}?artifact=prompt&prompt=${encodeURIComponent(prompt.key)}`}
            className="app-button secondary shrink-0"
          >
            Open prompt
            <ArrowSquareOutIcon size={12} />
          </Link>
        </div>
      </div>
      {detail.loading ? (
        <p className="text-[10px] text-[var(--text-muted)]">Loading prompt…</p>
      ) : detail.error ? (
        <p className="text-[10px] text-[var(--danger)]">{detail.error}</p>
      ) : (
        <pre className="mono max-h-[220px] overflow-auto border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-[10px] leading-5 whitespace-pre-wrap text-[var(--text-muted)]">
          {detail.data?.content ?? ""}
        </pre>
      )}
    </div>
  );
}
