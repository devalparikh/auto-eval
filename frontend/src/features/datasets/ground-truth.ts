export const SEVERITY_OPTIONS = ["critical", "high", "medium", "low"] as const;
export const ROUTE_OPTIONS = [
  "security",
  "data",
  "platform",
  "payments",
  "support",
] as const;

export type GroundTruth = {
  severity: string;
  route: string;
  requires_human: boolean;
};

export function groundTruthFromRecord(
  value: Record<string, unknown> | null | undefined,
): GroundTruth {
  return {
    severity: stringValue(value?.severity, "medium"),
    route: stringValue(value?.route, "support"),
    requires_human: Boolean(value?.requires_human),
  };
}

export function groundTruthFromForm(form: FormData): GroundTruth {
  return {
    severity: stringValue(form.get("severity"), "medium"),
    route: stringValue(form.get("route"), "support"),
    requires_human: form.get("requiresHuman") === "true",
  };
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}
