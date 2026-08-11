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
  }>;
}) {
  const { systemKey } = await params;
  const query = await searchParams;
  const requestedSnapshot = query.snapshot ?? query.runtimeSnapshot;
  const snapshotId = Array.isArray(requestedSnapshot)
    ? requestedSnapshot[0]
    : requestedSnapshot;
  return (
    <SystemsScreen
      systemKey={systemKey}
      initialSnapshotId={snapshotId}
    />
  );
}
