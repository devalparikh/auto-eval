import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Evaluation results" };

export default function ResultsPage() {
  redirect("/systems/incident-triage/results");
}
