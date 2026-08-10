import type { Metadata } from "next";
import { ResultsScreen } from "@/features/results/results-screen";

export const metadata: Metadata = { title: "Results" };

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ systemKey: string }>;
}) {
  const { systemKey } = await params;
  return <ResultsScreen systemKey={systemKey} />;
}
