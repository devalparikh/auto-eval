import type { Metadata } from "next";
import { ResultsScreen } from "@/features/results/results-screen";

export const metadata: Metadata = { title: "Evaluation results" };

export default function ResultsPage() {
  return <ResultsScreen />;
}
