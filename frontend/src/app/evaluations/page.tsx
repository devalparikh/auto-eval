import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Run evaluation" };

export default function EvaluationsPage() {
  redirect("/systems/incident-triage/evaluations");
}
