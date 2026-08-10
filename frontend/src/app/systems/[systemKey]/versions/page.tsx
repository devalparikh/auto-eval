import type { Metadata } from "next";
import { SystemsScreen } from "@/features/systems/systems-screen";

export const metadata: Metadata = { title: "Versions" };

export default async function VersionsPage({
  params,
}: {
  params: Promise<{ systemKey: string }>;
}) {
  const { systemKey } = await params;
  return <SystemsScreen systemKey={systemKey} />;
}
