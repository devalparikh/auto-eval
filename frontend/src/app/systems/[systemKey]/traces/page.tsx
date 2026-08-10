import type { Metadata } from "next";
import { TracesScreen } from "@/features/traces/traces-screen";

export const metadata: Metadata = { title: "Traces" };

export default async function TracesPage({
  params,
}: {
  params: Promise<{ systemKey: string }>;
}) {
  const { systemKey } = await params;
  return <TracesScreen systemKey={systemKey} />;
}
