"use client";

import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { Select } from "@/components/select";
import type {
  CodebaseCommit,
  CodebaseMode,
  CodebaseSource,
} from "@/lib/types";

const sources: Array<{ value: CodebaseSource; label: string }> = [
  { value: "current", label: "Structure" },
  { value: "working", label: "Local" },
  { value: "staged", label: "Staged" },
  { value: "commit", label: "Commit" },
  { value: "pr", label: "PR" },
];

export function CodebaseControls({
  mode,
  source,
  comparisonRef,
  commits,
  pullRequestsAvailable,
  loading,
  onModeChange,
  onSourceChange,
  onRefChange,
  onApply,
  onRefresh,
}: {
  mode: CodebaseMode;
  source: CodebaseSource;
  comparisonRef: string;
  commits: CodebaseCommit[];
  pullRequestsAvailable: boolean;
  loading: boolean;
  onModeChange: (mode: CodebaseMode) => void;
  onSourceChange: (source: CodebaseSource) => void;
  onRefChange: (ref: string) => void;
  onApply: () => void;
  onRefresh: () => void;
}) {
  const needsRef = source === "commit" || source === "pr";
  return (
    <section className="codebase-toolbar" aria-label="Code comparison controls">
      <div
        className="codebase-mode-switch"
        role="group"
        aria-label="Map mode"
      >
        <button
          type="button"
          aria-pressed={mode === "files"}
          onClick={() => onModeChange("files")}
        >
          Files
        </button>
        <button
          type="button"
          aria-pressed={mode === "logic"}
          onClick={() => onModeChange("logic")}
        >
          Logic
        </button>
      </div>
      <div
        className="codebase-source-switch"
        role="group"
        aria-label="Change set"
      >
        {sources.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={source === option.value}
            onClick={() => onSourceChange(option.value)}
            title={
              option.value === "pr" && !pullRequestsAvailable
                ? "Install GitHub CLI to compare pull requests"
                : undefined
            }
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="codebase-ref-control">
        {source === "commit" ? (
          <label className="field">
            <span>Revision</span>
            <Select
              value={comparisonRef}
              onChange={(event) => onRefChange(event.target.value)}
              aria-label="Commit revision"
            >
              {commits.map((commit) => (
                <option key={commit.oid} value={commit.oid}>
                  {commit.short_oid} / {commit.subject}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        {source === "pr" ? (
          <label className="field">
            <span>Pull request</span>
            <input
              className="app-input mono"
              value={comparisonRef}
              onChange={(event) => onRefChange(event.target.value)}
              placeholder="#42 or GitHub URL"
              aria-label="Pull request number or URL"
            />
          </label>
        ) : null}
      </div>
      <button
        type="button"
        className={needsRef ? "app-button" : "app-button secondary"}
        onClick={needsRef ? onApply : onRefresh}
        disabled={loading || (needsRef && !comparisonRef)}
      >
        <ArrowClockwiseIcon size={13} weight="bold" />
        {needsRef ? "Compare" : "Refresh"}
      </button>
    </section>
  );
}
