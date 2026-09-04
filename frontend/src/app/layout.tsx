import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { colorThemeFromCookie, THEME_COOKIE_NAME } from "@/lib/theme";
import "./globals.css";

const description =
  "Trace agent runs, save versioned test cases, and compare models on the same dataset.";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: { default: "AutoEval", template: "%s | AutoEval" },
  description,
  openGraph: {
    title: "AutoEval",
    description,
    siteName: "AutoEval",
    type: "website",
    images: [
      {
        url: "/images/autoeval-share-v1.jpg",
        width: 1200,
        height: 630,
        alt: "AutoEval. Trace your agent. Test every change.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AutoEval",
    description,
    images: ["/images/autoeval-share-v1.jpg"],
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
  const theme = colorThemeFromCookie(
    (await cookies()).get(THEME_COOKIE_NAME)?.value,
  );
  return (
    <html lang="en" data-theme={theme} data-scroll-behavior="smooth">
      <body>
        <AppShell initialTheme={theme}>{children}</AppShell>
      </body>
    </html>
  );
}
