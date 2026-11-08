import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsScreen } from "@/features/docs/docs-screen";
import { docsPageBySlug } from "@/features/docs/docs-pages";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = docsPageBySlug((await params).slug);
  return page
    ? { title: `${page.title} · Docs`, description: page.description }
    : {};
}

export default async function DocsArticlePage({ params }: Props) {
  const { slug } = await params;
  // The overview lives at /docs, not /docs/ with an empty slug.
  const page = slug ? docsPageBySlug(slug) : undefined;
  if (!page) notFound();
  return <DocsScreen page={page} />;
}
