export type Source = "synthetic" | "production";
export type RunStatus = "ok" | "error" | "partial" | "cancelled";
export type Scalar = number | boolean | string | null;
export type Value = Scalar | Value[] | { [key: string]: Value };
export interface ValueSchema {
  type: "string" | "number" | "integer" | "boolean" | "object" | "array";
  maxLength?: number;
  maxItems?: number;
  properties?: Record<string, ValueSchema>;
  items?: ValueSchema | null;
  enum?: string[] | null;
}
export interface EventDefinition {
  attributes?: Record<string, ValueSchema>;
}
export interface Policy {
  schemaVersion: 2;
  metrics?: Record<
    string,
    {
      semanticId: string;
      definitionVersion: number;
      unit: string;
      min?: number | null;
      max?: number | null;
    }
  >;
  checks?: Record<
    string,
    { semanticId: string; definitionVersion: number; expected: boolean | null }
  >;
  steps?: Record<string, EventDefinition>;
  outcomes?: Record<string, EventDefinition>;
  content?: Record<string, { category: string; valueSchema: ValueSchema }>;
}
export interface Experiment {
  revision: {
    kind: "git-sha1" | "git-sha256" | "artifact-sha256";
    value: string;
  };
  promptHash: string | null;
  configHash: string;
  graphHash: string | null;
  models: { role: string; provider: string; model: string }[];
  mode?: "observed" | "scripted" | "live";
  datasetHash?: string | null;
  runId?: string | null;
}
/** Server-resolved user choice. Omission/false/expired is always off. New scope needs a new grant ID. */
export interface Consent {
  granted: boolean;
  id: string;
  categories?: string[];
  expiresAt?: number | null;
}
export interface Reference {
  traceId: string;
  policyVersion: string;
  experimentId: string;
  grantId: string;
}
export type Coverage = Record<
  string,
  | "not_measured"
  | "not_authorized"
  | "invalid_value"
  | "redaction_failed"
  | "size_limit"
  | "retention_expired"
>;
export type Result =
  | {
      status: "accepted";
      reference?: Reference;
      id?: string;
      coverage: Coverage;
    }
  | { status: "revoked" }
  | {
      status: "skipped";
      reason:
        | "disabled"
        | "invalid_config"
        | "no_consent"
        | "invalid_input"
        | "unauthorized"
        | "busy"
        | "timeout"
        | "unavailable"
        | "rejected"
        | "production_disabled"
        | "already_ended"
        | "capacity";
    };
export interface Step {
  id: string;
  parentId?: string | null;
  kind: "model" | "tool" | "validation" | "persistence" | "admission";
  name: string;
  status: RunStatus;
  durationMs?: number | null;
  attributes?: Record<string, Scalar>;
}
export type Content = Record<string, Value> | (() => Record<string, Value>);
export interface Run {
  readonly reference: Readonly<Reference> | null;
  /** Synchronous, local, no I/O. Returns false for disabled, invalid or over-budget steps. */
  step(step: Step): boolean;
  /** Schedule through the host's after-response/waitUntil hook. Never await on the reply path. */
  end(result?: {
    endedAt?: number;
    status?: RunStatus;
    metrics?: Record<string, number | null>;
    checks?: Record<string, boolean | null>;
    content?: Content;
  }): Promise<Result>;
}
export interface Capture {
  readonly enabled: boolean;
  readonly reason: string | null;
  begin(input?: {
    consent?: Consent | null;
    id?: string;
    startedAt?: number;
    caseId?: string | null;
  }): Run;
  outcome(input: {
    consent: Consent;
    reference: Reference;
    id?: string;
    occurredAt?: number;
    name: string;
    attributes?: Record<string, Scalar>;
    content?: Content;
  }): Promise<Result>;
  /** Caller durably records withdrawal and reconciles a non-revoked result. No trace retries. */
  withdraw(input: { grantId: string }): Promise<Result>;
}
export interface Options {
  enabled?: boolean;
  endpoint?: string;
  token?: string;
  source?: Source;
  timeoutMs?: number;
  policy?: Policy;
  experiment?: Experiment;
  redactorVersion?: string | null;
}
export function createCapture(options?: Options): Capture;
export function createCaptureFromEnv(options?: {
  policy?: Policy;
  experiment?: Experiment;
  redactorVersion?: string | null;
  env?: Record<string, string | undefined>;
}): Capture;
/** SHA-256 of a reviewed static artifact; hashes locally and does not send its contents. */
export function artifactHash(value: string): string;
