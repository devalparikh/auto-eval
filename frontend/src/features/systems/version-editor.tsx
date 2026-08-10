"use client";

import { useState, type ReactNode } from "react";
import { LoadingState } from "@/components/states";
import { formatDate } from "@/lib/format";
import type { VersionSummary } from "@/lib/types";

export function VersionEditor({
  kind,
  title,
  description,
  icon,
  versions,
  selectedVersionId,
  onVersionChange,
  content,
  loading,
  recordId,
  onSave,
}: {
  kind: "graph" | "prompt";
  title: string;
  description: string;
  icon: ReactNode;
  versions: VersionSummary[];
  selectedVersionId: string;
  onVersionChange: (value: string) => void;
  content: string;
  loading: boolean;
  recordId: string;
  onSave: (recordId: string, content: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave(recordId, draft);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not create version";
      setError(
        kind === "graph" && caught instanceof SyntaxError
          ? "Graph definition must be valid JSON."
          : message,
      );
    } finally {
      setSaving(false);
    }
  }

  const selected = versions.find((version) => version.id === selectedVersionId);
  return (
    <article className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
        <div className="flex min-w-0 gap-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--accent-soft)] text-[var(--accent)]">
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold">{title}</h2>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">{description}</p>
          </div>
        </div>
        <select
          aria-label={`${kind} version`}
          className="app-select w-auto min-w-[110px]"
          value={selectedVersionId}
          onChange={(event) => onVersionChange(event.target.value)}
        >
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              Version {version.version}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 border-b border-[var(--border)] text-[10px]">
        <VersionMeta label="Version" value={`v${selected?.version ?? "-"}`} />
        <VersionMeta
          label="Created"
          value={selected ? formatDate(selected.created_at) : "-"}
        />
        <VersionMeta label="Hash" value={selected?.content_hash?.slice(0, 9) ?? "-"} mono />
      </div>
      <div className="p-4">
        {loading ? (
          <LoadingState rows={6} />
        ) : (
          <textarea
            aria-label={kind === "graph" ? "Graph definition" : "System prompt"}
            className="app-textarea mono min-h-[440px] text-[10px] leading-5"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
          />
        )}
        <div className="mt-3 flex items-center justify-between gap-4">
          <div>
            {error ? <p className="text-[11px] text-[var(--danger)]">{error}</p> : null}
            <p className="text-[10px] text-[var(--text-muted)]">
              Saving creates a new immutable version.
            </p>
          </div>
          <button
            className="app-button"
            disabled={saving || loading || draft === content}
            onClick={save}
          >
            {saving ? "Saving..." : "Save new version"}
          </button>
        </div>
      </div>
    </article>
  );
}

function VersionMeta({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="border-r border-[var(--border)] px-4 py-2.5 last:border-r-0">
      <p className="text-[var(--text-faint)]">{label}</p>
      <p className={`mt-1 font-medium ${mono ? "mono" : ""}`}>{value}</p>
    </div>
  );
}
