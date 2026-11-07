import { apiRequest } from "@/lib/api";
import type { components } from "@/lib/api-schema";
export type Workspace = components["schemas"]["HarnessWorkspace"];
export type Capture = components["schemas"]["HarnessCapture"];
export type Run = components["schemas"]["HarnessRun"];
export type Task = components["schemas"]["HarnessTask"];
export type TrainingExport = components["schemas"]["HarnessTrainingExport"];
export const harnessApi = {
  run: (key: string, id: string) =>
    apiRequest<Run>(`/harnesses/${encodeURIComponent(key)}/runs/${id}`),
  connect: (body: components["schemas"]["ConnectHarness"]) =>
    apiRequest<Workspace>("/harnesses", { method: "POST", body }),
  workspace: (key: string) =>
    apiRequest<Workspace>(`/harnesses/${encodeURIComponent(key)}`),
  post: <T>(key: string, path: string, body?: unknown) =>
    apiRequest<T>(`/harnesses/${encodeURIComponent(key)}/${path}`, {
      method: "POST",
      body,
    }),
  capture: (key: string, id: string) =>
    apiRequest<Capture>(`/harnesses/${encodeURIComponent(key)}/captures/${id}`),
};
