import type { Metadata } from "next";
import { SystemOverviewScreen } from "@/features/systems/system-overview-screen";

export const metadata: Metadata = { title: "Agent system" };

export default async function AgentSystemPage({
  params,
}: {
  params: Promise<{ systemKey: string }>;
}) {
  const { systemKey } = await params;
  return <SystemOverviewScreen systemKey={systemKey} />;
}
