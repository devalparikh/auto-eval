import type { Metadata } from "next";
import { RunScreen } from "@/features/run/run-screen";

export const metadata: Metadata = { title: "Run inference" };

export default async function RunPage({
  params,
}: {
  params: Promise<{ systemKey: string }>;
}) {
  const { systemKey } = await params;
  return <RunScreen systemKey={systemKey} />;
}
