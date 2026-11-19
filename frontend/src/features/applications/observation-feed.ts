import { formatCost, formatDuration } from "@/lib/format";
import type { AppKey } from "./application-types";

export type TraceGrade = {
  id: string;
  revision: number;
  version: number;
  definitionId: string;
  source: "client";
  kind: "boolean" | "number" | "category" | "multi_select" | "json";
  value?: boolean | number | string | string[];
  occurredAt: number;
};

export function gradeLabel(grade?: TraceGrade | null) {
  if (!grade) return "Ungraded";
  if (grade.kind === "json") return "Structured JSON";
  if (typeof grade.value === "boolean") return grade.value ? "Pass" : "Fail";
  if (Array.isArray(grade.value)) {
    if (!grade.value.length) return "None selected";
    return grade.value.join(", ");
  }
  return String(grade.value);
}

/** One row of `GET /applications/{id}/traces`. Older rows may omit times. */
export type FeedObservation = {
  id: string;
  experimentId: string;
  grade?: TraceGrade | null;
  source: string;
  status: string;
  startedAt?: number;
  endedAt?: number;
  metrics: Record<string, number | null>;
  checks: Record<string, boolean | null>;
};

/**
 * Where an application stands, in workflow order. Each screen state answers
 * "what do I do next" from this one value rather than from scattered lengths.
 */
export type ApplicationStage = "connect" | "waiting" | "receiving";

export function applicationStage({
  traces,
  keys,
  now,
}: {
  traces: readonly FeedObservation[];
  keys: readonly AppKey[];
  now: number;
}): ApplicationStage {
  if (traces.length > 0) return "receiving";
  return keys.some((key) => keyIsUsable(key, now)) ? "waiting" : "connect";
}

export function keyIsUsable(key: AppKey, now: number): boolean {
  if (key.revoked) return false;
  if (key.expiresAt != null && key.expiresAt <= now) return false;
  if (key.retireAt != null && key.retireAt <= now) return false;
  return true;
}

export type FeedSummary = {
  total: number;
  errors: number;
  /** Traces where at least one declared check came back false. */
  failedChecks: number;
  lastSeen: number | null;
};

export function summarizeFeed(traces: readonly FeedObservation[]): FeedSummary {
  let errors = 0;
  let failedChecks = 0;
  let lastSeen: number | null = null;
  for (const trace of traces) {
    if (trace.status !== "ok") errors++;
    if (Object.values(trace.checks ?? {}).some((value) => value === false))
      failedChecks++;
    const time = trace.endedAt ?? trace.startedAt;
    if (typeof time === "number" && (lastSeen === null || time > lastSeen))
      lastSeen = time;
  }
  return { total: traces.length, errors, failedChecks, lastSeen };
}

export type CheckResult = { name: string; value: boolean | null };

/** Failures first, then unknowns, then passes, so the row leads with news. */
export function orderedChecks(
  checks: Record<string, boolean | null> | undefined,
): CheckResult[] {
  const rank = (value: boolean | null) =>
    value === false ? 0 : value === null ? 1 : 2;
  return Object.entries(checks ?? {})
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => rank(a.value) - rank(b.value) || a.name.localeCompare(b.name));
}

/**
 * A metric value as a reader expects it. Units come from the key suffix the
 * SDK convention uses (`_ms`, `_usd`); anything else prints as a plain number.
 * Null means "not measured", never zero.
 */
export function formatMetric(name: string, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (name.endsWith("_ms")) return formatDuration(value);
  if (name.endsWith("_usd")) return formatCost(value);
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

export function traceDuration(trace: FeedObservation): number | null {
  if (typeof trace.startedAt !== "number" || typeof trace.endedAt !== "number")
    return null;
  return Math.max(0, trace.endedAt - trace.startedAt);
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatAgo(time: number, now: number): string {
  const seconds = Math.round((time - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), "hour");
  return relative.format(Math.round(seconds / 86400), "day");
}

export function formatTimestamp(time: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(time));
}

/**
 * Which application to open without asking: the one named in the URL, else
 * the only one there is. A URL naming an application that no longer exists
 * (or was never shared) is ignored rather than trusted.
 */
export function initialApplication(
  ids: readonly string[],
  fromUrl: string | null,
): string {
  if (fromUrl && ids.includes(fromUrl)) return fromUrl;
  return ids.length === 1 ? ids[0] : "";
}
