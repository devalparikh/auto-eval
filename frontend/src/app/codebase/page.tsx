import type { Metadata } from "next";
import { CodebaseScreen } from "@/features/codebase/codebase-screen";

export const metadata: Metadata = {
  title: "Code map",
  description: "Explore code structure and Git changes as a semantic graph.",
};

export default function CodebasePage() {
  return <CodebaseScreen />;
}
