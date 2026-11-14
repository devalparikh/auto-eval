export interface Policy {
  metrics: string[];
  checks: string[];
}
export interface Grant {
  id: string;
  source: "synthetic" | "production";
  expiresAt: number;
  policy: "metadata-v1";
}
export interface Experiment {
  id: string;
  revision: string;
  promptHash: string;
  configHash: string;
  graphHash: string | null;
  model: string;
  mode: "scripted" | "live" | "observed";
  datasetHash: string | null;
}
export interface Projection {
  metrics: Record<string, number | null>;
  checks: Record<string, boolean | null>;
}
export interface CaptureInput {
  consent: Grant | null;
  project: () => Projection;
  caseId?: string | null;
  startedAt: number;
  endedAt: number;
  status?: "ok" | "error" | "partial";
}
export interface CaptureResult {
  status: "disabled" | "no-consent" | "accepted" | "rejected" | "dropped";
  id?: string;
}
export interface CaptureOptions {
  enabled?: boolean;
  endpoint?: string;
  token?: string;
  experimentId?: string;
  source?: "synthetic" | "production";
  policy?: Policy;
  timeoutMs?: number;
}
export function createCapture(options?: CaptureOptions): {
  capture(input: CaptureInput): Promise<CaptureResult>;
};
