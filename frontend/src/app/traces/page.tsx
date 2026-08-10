import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Traces" };

export default function TracesPage() {
  redirect("/systems/incident-triage/traces");
}
