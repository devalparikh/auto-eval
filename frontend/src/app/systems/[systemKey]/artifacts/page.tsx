import type { Metadata } from "next";
import { SystemsScreen } from "@/features/systems/systems-screen";

export const metadata: Metadata = { title: "Artifacts" };

export default async function ArtifactsPage({
  params,
}: {
  params: Promise<{ systemKey: string }>;
}) {
  const { systemKey } = await params;
  return <SystemsScreen systemKey={systemKey} />;
}
