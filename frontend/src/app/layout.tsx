import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { colorThemeFromCookie, THEME_COOKIE_NAME } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AutoEval", template: "%s | AutoEval" },
  description:
    "Connect any agent system, inspect traces, curate datasets, and run reproducible evaluations across models and providers.",
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
