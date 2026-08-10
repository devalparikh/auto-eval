import type { Metadata } from "next";
import { EvaluationsScreen } from "@/features/evaluations/evaluations-screen";

export const metadata: Metadata = { title: "Run evaluation" };

export default function EvaluationsPage() {
  return <EvaluationsScreen />;
}
