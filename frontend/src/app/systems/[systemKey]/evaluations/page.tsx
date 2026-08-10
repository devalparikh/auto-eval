import type { Metadata } from "next";
import { EvaluationsScreen } from "@/features/evaluations/evaluations-screen";

export const metadata: Metadata = { title: "Evaluate" };

export default async function EvaluationsPage({
  params,
}: {
  params: Promise<{ systemKey: string }>;
}) {
  const { systemKey } = await params;
  return <EvaluationsScreen systemKey={systemKey} />;
}
