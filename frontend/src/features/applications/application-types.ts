import type { components } from "@/lib/api-schema";
export type CaptureSettings = components["schemas"]["CaptureSettings"];
export type Policy = components["schemas"]["Policy"] & { id: string };
export type Observation = components["schemas"]["Observation"];
export type Application = {
  id: string;
  name: string;
  settings: CaptureSettings;
  settingsVersion: string;
};
export type AppKey = {
  id: string;
  label: string;
  scope: string;
  createdAt: number;
  expiresAt: number;
  retireAt: number | null;
  revoked: boolean;
};
export type TraceDetail = {
  trace: Observation;
  outcomes: (components["schemas"]["Outcome"] & {
    coverage: Record<string, string>;
  })[];
  assessments: {
    id: string;
    scorerHash: string;
    ratings: Record<string, string>;
  }[];
  content: Record<string, unknown>;
};
