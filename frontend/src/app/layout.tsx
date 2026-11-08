import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { SIDEBAR_COOKIE_NAME, sidebarStateFromCookie } from "@/lib/sidebar";
import { colorThemeFromCookie, THEME_COOKIE_NAME } from "@/lib/theme";
import "./globals.css";

const description =
  "Trace agent runs, save real cases as tests, and benchmark every model and graph change on quality, cost, and latency.";

const siteUrl = new URL(
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
);

// Rendered by share-card/render.mjs. Most link previews show the still; Messages
// and some chat apps play the loop, which opens on the same frame. Bump the
// version in both names when they change, since platforms cache by URL.
const shareImage = {
  url: "/images/autoeval-share-v2.jpg",
  width: 1200,
  height: 630,
  alt: "AutoEval. Trace your agent. Test every change. A benchmark where graph v8 ranks first at 96%, three points over the baseline.",
};

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: { default: "AutoEval", template: "%s | AutoEval" },
  description,
  openGraph: {
    title: "AutoEval",
    description,
    siteName: "AutoEval",
    type: "website",
    images: [shareImage],
    videos: [
      {
        // metadataBase resolves images but not videos, and a preview crawler
        // needs a direct, absolute link to the file.
        url: new URL("/images/autoeval-share-v2.mp4", siteUrl),
        type: "video/mp4",
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AutoEval",
    description,
    images: [shareImage],
  },
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Reading request headers guarantees nonce-bearing responses render per request.
  await headers();
  const cookieStore = await cookies();
  const theme = colorThemeFromCookie(cookieStore.get(THEME_COOKIE_NAME)?.value);
  const sidebar = sidebarStateFromCookie(
    cookieStore.get(SIDEBAR_COOKIE_NAME)?.value,
  );
  return (
    <html lang="en" data-theme={theme} data-scroll-behavior="smooth">
      <body>
        <AppShell initialTheme={theme} initialSidebar={sidebar}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
