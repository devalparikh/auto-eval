"use client";

import { ArrowsOutIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal } from "@/components/modal";
import { Select } from "@/components/select";
import { LoadingState } from "@/components/states";
import { AgentGraph } from "@/features/systems/agent-graph";
import { GraphEditor } from "@/features/systems/graph-editor";
import {
  graphDefinitionFromSource,
  graphDefinitionToSource,
  validateGraphDefinition,
} from "@/features/systems/graph-editor-model";
import { formatDate } from "@/lib/format";
import { playPreferredUiSound } from "@/lib/sound";
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
  records,
  selectedRecordId,
  onRecordChange,
  associations = [],
  systemKey,
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
  records?: Array<{ id: string; name: string }>;
  selectedRecordId?: string;
  onRecordChange?: (value: string) => void;
  associations?: Array<{ nodeId: string; label: string }>;
  systemKey?: string;
}) {
  const [draft, setDraft] = useState(content);
  const [graphView, setGraphView] = useState<"graph" | "edit" | "source">(
    "graph",
  );
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = draft !== content;
  const parsedGraph = useMemo(
    () => (kind === "graph" ? graphDefinitionFromSource(draft) : null),
    [draft, kind],
  );
  const graphDefinition = parsedGraph?.ok ? parsedGraph.definition : null;
  const graphParseMessage =
    parsedGraph && !parsedGraph.ok ? parsedGraph.message : null;
  const graphIssues = useMemo(
    () => (graphDefinition ? validateGraphDefinition(graphDefinition) : []),
    [graphDefinition],
  );

  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);

  function canDiscardDraft() {
    return (
      !dirty || window.confirm("Discard the unsaved changes to this version?")
    );
  }

  async function save() {
    if (kind === "graph") {
      if (!parsedGraph?.ok) {
        setError(parsedGraph?.message ?? "Graph definition is invalid.");
        return;
      }
      if (graphIssues.length) {
        setError("Fix the graph issues before saving a new version.");
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(recordId, draft);
      playPreferredUiSound("success");
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not create version";
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
    <article className="version-editor overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
        <div className="flex min-w-0 gap-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--accent-soft)] text-[var(--accent)]">
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold">{title}</h2>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              {description}
            </p>
          </div>
        </div>
        <div className="grid shrink-0 gap-2">
          {records && selectedRecordId && onRecordChange ? (
            <Select
              aria-label="Prompt family"
              containerClassName="version-select"
              value={selectedRecordId}
              onChange={(event) => {
                if (canDiscardDraft()) onRecordChange(event.target.value);
              }}
            >
              {records.map((record) => (
                <option key={record.id} value={record.id}>
                  {record.name}
                </option>
              ))}
            </Select>
          ) : null}
          <Select
            aria-label={`${kind} version`}
            containerClassName="version-select"
            value={selectedVersionId}
            onChange={(event) => {
              if (canDiscardDraft()) onVersionChange(event.target.value);
            }}
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                Version {version.version}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-3 border-b border-[var(--border)] text-[10px]">
        <VersionMeta label="Version" value={`v${selected?.version ?? "-"}`} />
        <VersionMeta
          label="Created"
          value={selected ? formatDate(selected.created_at) : "-"}
        />
        <VersionMeta
          label="Hash"
          value={selected?.content_hash?.slice(0, 9) ?? "-"}
          mono
        />
      </div>
      <div className="p-4">
        {kind === "prompt" ? (
          <div className="rounded-[var(--radius)] mb-3 border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5">
            <p className="text-[10px] font-medium">
              {associations.length
                ? `Used by ${associations.length} node${associations.length === 1 ? "" : "s"} in the selected graph`
                : "Not used by the selected graph"}
            </p>
            {associations.length ? (
              <ul className="mt-1.5 grid gap-1">
                {associations.map(({ nodeId, label }) => (
                  <li
                    key={nodeId}
                    className="flex items-baseline gap-2 text-[9px]"
                  >
                    <span className="text-[var(--text-muted)]">{label}</span>
                    <span className="mono text-[var(--text-faint)]">
                      {nodeId}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {loading ? (
          <LoadingState rows={6} />
        ) : kind === "graph" ? (
          <>
            <div className="version-view-toolbar">
              <div
                className="version-view-switch"
                aria-label="Graph definition view"
              >
                <button
                  type="button"
                  aria-pressed={graphView === "graph"}
                  disabled={!graphDefinition}
                  onClick={() => setGraphView("graph")}
                >
                  Preview
                </button>
                <button
                  type="button"
                  aria-pressed={graphView === "edit"}
                  disabled={!graphDefinition}
                  onClick={() => setGraphView("edit")}
                >
                  Edit graph
                </button>
                <button
                  type="button"
                  aria-pressed={graphView === "source"}
                  onClick={() => setGraphView("source")}
                >
                  Source
                </button>
              </div>
              {graphView === "graph" && graphDefinition ? (
                <button
                  type="button"
                  className="app-button secondary"
                  onClick={() => setExpanded(true)}
                >
                  <ArrowsOutIcon size={13} />
                  Expand graph
                </button>
              ) : null}
            </div>
            {graphView === "graph" && graphDefinition ? (
              <AgentGraph definition={graphDefinition} />
            ) : graphView === "edit" && graphDefinition ? (
              <GraphEditor
                definition={graphDefinition}
                systemKey={systemKey}
                onChange={(definition) => {
                  setDraft(graphDefinitionToSource(definition));
                  setError(null);
                }}
              />
            ) : (
              <textarea
                aria-label="Graph definition"
                aria-invalid={!parsedGraph?.ok || graphIssues.length > 0}
                aria-describedby="graph-editor-help"
                className="app-textarea mono version-source-editor text-[10px] leading-5"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setError(null);
                }}
                spellCheck={false}
              />
            )}
          </>
        ) : (
          <textarea
            aria-label="System prompt"
            className="app-textarea mono version-source-editor text-[10px] leading-5"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
          />
        )}
        <div className="mt-3 flex items-center justify-between gap-4">
          <div>
            {error ? (
              <p role="alert" className="text-[11px] text-[var(--danger)]">
                {error}
              </p>
            ) : null}
            <p
              id={kind === "graph" ? "graph-editor-help" : undefined}
              className="text-[10px] text-[var(--text-muted)]"
            >
              {kind === "graph" && !graphDefinition
                ? (graphParseMessage ??
                  "The current source is not a valid agent graph definition.")
                : kind === "graph" && graphIssues.length
                  ? `Fix ${graphIssues.length} graph ${graphIssues.length === 1 ? "issue" : "issues"} before saving.`
                  : "Saving creates a new immutable version."}
            </p>
          </div>
          <button
            className="app-button"
            disabled={
              saving ||
              loading ||
              !dirty ||
              (kind === "graph" && (!graphDefinition || graphIssues.length > 0))
            }
            onClick={save}
          >
            {saving ? "Saving..." : "Save new version"}
          </button>
        </div>
      </div>
      {kind === "graph" && graphDefinition ? (
        <Modal
          open={expanded}
          size="fullscreen"
          title="Agent graph"
          onClose={() => setExpanded(false)}
        >
          <AgentGraph definition={graphDefinition} fullscreen />
        </Modal>
      ) : null}
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
