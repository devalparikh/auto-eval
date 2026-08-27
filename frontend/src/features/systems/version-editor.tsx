"use client";

import { ArrowsOutIcon, CheckIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { Modal } from "@/components/modal";
import { Select } from "@/components/select";
import { LoadingState } from "@/components/states";
import {
  graphDraftChanged,
  graphDraftChanges,
} from "@/features/graph/node-edit";
import { AgentGraph, isGraphDefinition } from "@/features/systems/agent-graph";
import { formatDate } from "@/lib/format";
import { playPreferredUiSound } from "@/lib/sound";
import type {
  GraphDefinition,
  PromptSummary,
  VersionSummary,
} from "@/lib/types";

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
  prompts,
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
  /** Links a graph's model nodes to their prompts. Graph kind only. */
  systemKey?: string;
  /** This system's prompts, so a model node can show the one it runs. */
  prompts?: PromptSummary[];
}) {
  const [draft, setDraft] = useState(content);
  const [graphView, setGraphView] = useState<"graph" | "json">("graph");
  const [editing, setEditing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave(recordId, draft);
      playPreferredUiSound("success");
    } catch (caught) {
      setError(saveFailureMessage(caught, kind));
    } finally {
      setSaving(false);
    }
  }

  const selected = versions.find((version) => version.id === selectedVersionId);
  const parsedGraph = parseJson(draft);
  const graphDefinition =
    parsedGraph.ok && isGraphDefinition(parsedGraph.value)
      ? parsedGraph.value
      : null;
  const parsedSaved = parseJson(content);
  const savedGraph =
    parsedSaved.ok && isGraphDefinition(parsedSaved.value)
      ? parsedSaved.value
      : null;
  const unsaved = draft !== content;
  // The graph and the JSON are two views of one draft: an edit on the canvas
  // comes back as a whole definition and is written straight back to the source.
  const changeGraphDraft = (next: GraphDefinition) =>
    setDraft(JSON.stringify(next, null, 2));
  const namedChanges =
    savedGraph && graphDefinition && graphDraftChanged(savedGraph, graphDefinition)
      ? graphDraftChanges(savedGraph, graphDefinition)
      : [];

  function stopEditing() {
    if (unsaved) {
      setDiscarding(true);
      return;
    }
    setEditing(false);
  }

  function discardChanges() {
    setDraft(content);
    setDiscarding(false);
    setEditing(false);
    setError(null);
  }

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
              onChange={(event) => onRecordChange(event.target.value)}
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
            onChange={(event) => onVersionChange(event.target.value)}
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
          <div className="mb-3 border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5">
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
                  Graph
                </button>
                <button
                  type="button"
                  aria-pressed={graphView === "json"}
                  onClick={() => setGraphView("json")}
                >
                  JSON
                </button>
              </div>
              {graphView === "graph" && graphDefinition ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="app-button secondary"
                    aria-pressed={editing}
                    onClick={() => (editing ? stopEditing() : setEditing(true))}
                  >
                    {editing ? (
                      <CheckIcon size={13} />
                    ) : (
                      <PencilSimpleIcon size={13} />
                    )}
                    {editing ? "Done editing" : "Edit"}
                  </button>
                  <button
                    type="button"
                    className="app-button secondary"
                    onClick={() => setExpanded(true)}
                  >
                    <ArrowsOutIcon size={13} />
                    Expand graph
                  </button>
                </div>
              ) : null}
            </div>
            {graphView === "graph" && graphDefinition ? (
              <AgentGraph
                definition={graphDefinition}
                systemKey={systemKey}
                prompts={prompts}
                editable={editing}
                onDraftChange={changeGraphDraft}
              />
            ) : (
              <textarea
                aria-label="Graph definition"
                aria-invalid={!parsedGraph.ok}
                aria-describedby="graph-editor-help"
                className="app-textarea mono version-source-editor text-[10px] leading-5"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
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
        {kind === "graph" && unsaved && !loading ? (
          <div className="mt-3 border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5">
            <p className="text-[10px] font-medium">
              What the next version changes
            </p>
            {namedChanges.length ? (
              <ul className="mt-1.5 grid gap-1">
                {namedChanges.map((change) => (
                  <li
                    key={`${change.nodeId}-${change.field}`}
                    className="text-[9px] leading-4 text-[var(--text-muted)]"
                  >
                    {change.summary}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-[9px] leading-4 text-[var(--text-muted)]">
                This draft differs from version {selected?.version ?? "-"}. Check
                the JSON view to see how.
              </p>
            )}
          </div>
        ) : null}
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
                ? "The current source is not a valid agent graph definition."
                : "Saving creates a new immutable version."}
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
      {kind === "graph" && graphDefinition ? (
        <Modal
          open={expanded}
          size="fullscreen"
          title="Agent graph"
          onClose={() => setExpanded(false)}
        >
          <AgentGraph
            definition={graphDefinition}
            fullscreen
            systemKey={systemKey}
            prompts={prompts}
            editable={editing}
            onDraftChange={changeGraphDraft}
          />
        </Modal>
      ) : null}
      {kind === "graph" ? (
        <Modal
          open={discarding}
          title="Discard your changes?"
          description="Nothing has been saved yet, so leaving edit mode puts this graph back the way you found it."
          onClose={() => setDiscarding(false)}
        >
          <div className="flex flex-wrap justify-end gap-2 px-5 py-4">
            <button
              type="button"
              className="app-button secondary"
              onClick={() => setDiscarding(false)}
            >
              Keep editing
            </button>
            <button
              type="button"
              className="app-button danger"
              onClick={discardChanges}
            >
              Discard changes
            </button>
          </div>
        </Modal>
      ) : null}
    </article>
  );
}

function saveFailureMessage(caught: unknown, kind: "graph" | "prompt"): string {
  if (kind === "graph" && caught instanceof SyntaxError) {
    return "Graph definition must be valid JSON.";
  }
  const message =
    caught instanceof Error ? caught.message : "Could not create version";
  const existing = /already exists as version (\d+)/.exec(message);
  if (existing) {
    return `This is already version ${existing[1]}. Choose it from the version list — there is nothing new to save.`;
  }
  return message;
}

function parseJson(
  value: string,
): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return { ok: false };
  }
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
