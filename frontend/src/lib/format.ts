export function formatDuration(value: number): string {
  if (value < 1) return `${Math.round(value * 1000)}µs`;
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

export function formatCost(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(5)}`;
  return `$${value.toFixed(2)}`;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function shortId(value: string): string {
  return value.slice(0, 8);
}

export function textPreview(
  value: Record<string, unknown>,
  fallback = "Structured request",
): string {
  for (const key of ["text", "question", "query", "prompt", "message", "title", "name"]) {
    const text = value[key];
    if (typeof text === "string" && text.trim()) {
      const compact = text.trim().replace(/\s+/g, " ");
      return compact.length > 180 ? `${compact.slice(0, 177)}…` : compact;
    }
  }
  const keys = Object.keys(value);
  if (!keys.length) return fallback;
  const fields = keys.slice(0, 3).map((key) => key.replaceAll("_", " ")).join(", ");
  return `${fallback} · ${fields}${keys.length > 3 ? ` +${keys.length - 3}` : ""}`;
}
