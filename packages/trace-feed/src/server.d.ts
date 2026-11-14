import type { Policy } from "./index.js";
export interface FeedOptions {
  path: string;
  principals: {
    token: string;
    project: string;
    role: "ingest" | "read" | "admin";
  }[];
  projects: { id: string; policy: Policy }[];
  allowProduction?: boolean;
  ttlMs?: number;
  now?: () => number;
  port?: number;
}
export function startFeed(
  options: FeedOptions,
): Promise<{ endpoint: string; close(): Promise<void> }>;
