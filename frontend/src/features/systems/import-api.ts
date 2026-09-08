import type { components } from "@/lib/api-schema";
import { apiRequest } from "@/lib/api";

export type ImportPreview = components["schemas"]["SystemImportPreview"];
export type ImportResult = components["schemas"]["SystemImportResult"];
export type ImportManifest = components["schemas"]["AutoEvalManifest"];
export type ImportCommit = components["schemas"]["SystemImportCommitRequest"];

export const importApi = {
  inspectManifest: (manifest: unknown) =>
    apiRequest<ImportPreview>("/system-imports/inspect", {
      method: "POST",
      body: { manifest },
    }),
  inspectGithub: (github_url: string) =>
    apiRequest<ImportPreview>("/system-imports/inspect", {
      method: "POST",
      body: { github_url },
    }),
  commit: (body: ImportCommit) =>
    apiRequest<ImportResult>("/system-imports/commit", {
      method: "POST",
      body,
    }),
};
