import type { Metadata } from "next";
import { TraceSelectionPrompt } from "@/features/traces/traces-workspace";

export const metadata: Metadata = { title: "Traces" };

export default async function TracesPage({
  params,
}: {
  params: Promise<{ systemKey: string }>;
}) {
  const { systemKey } = await params;
  return <TraceSelectionPrompt systemKey={systemKey} />;
}
