import type { Metadata } from "next";
import { DocsScreen } from "@/features/docs/docs-screen";
import { docsPageBySlug } from "@/features/docs/docs-pages";

const overview = docsPageBySlug("")!;

export const metadata: Metadata = {
  title: "Docs",
  description: overview.description,
};

export default function DocsPage() {
  return <DocsScreen page={overview} />;
}
