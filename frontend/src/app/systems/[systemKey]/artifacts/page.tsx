import type { Metadata } from "next";
import { SystemsScreen } from "@/features/systems/systems-screen";

export const metadata: Metadata = { title: "Artifacts" };

export default async function ArtifactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ systemKey: string }>;
  searchParams: Promise<{
    snapshot?: string | string[];
    runtimeSnapshot?: string | string[];
    artifact?: string | string[];
    prompt?: string | string[];
  }>;
}) {
  const { systemKey } = await params;
  const query = await searchParams;
  const requestedSnapshot = query.snapshot ?? query.runtimeSnapshot;
  const snapshotId = Array.isArray(requestedSnapshot)
    ? requestedSnapshot[0]
    : requestedSnapshot;
  const artifact = first(query.artifact);
  return (
    <SystemsScreen
      systemKey={systemKey}
      initialSnapshotId={snapshotId}
      initialArtifact={
        artifact === "graph" || artifact === "prompt" || artifact === "snapshot"
          ? artifact
          : undefined
      }
      initialPromptKey={first(query.prompt)}
    />
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
