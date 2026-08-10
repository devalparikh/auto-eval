"use client";

import {
  BezierCurveIcon,
  ChartScatterIcon,
  DatabaseIcon,
  FlaskIcon,
  GitBranchIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const navItems = [
  { href: "/traces", label: "Traces", icon: BezierCurveIcon },
  { href: "/datasets", label: "Datasets", icon: DatabaseIcon },
  { href: "/evaluations", label: "Run eval", icon: FlaskIcon },
  { href: "/results", label: "Results", icon: ChartScatterIcon },
  { href: "/systems", label: "Versions", icon: GitBranchIcon },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-[100dvh] md:grid md:grid-cols-[216px_minmax(0,1fr)]">
      <aside className="border-b border-white/8 bg-[var(--sidebar)] text-white md:sticky md:top-0 md:h-[100dvh] md:border-r md:border-b-0">
        <div className="flex h-16 items-center gap-3 px-4 md:h-[72px] md:px-5">
          <div className="grid size-8 place-items-center rounded-[8px] bg-[#eff4ff] text-[#244b9b]">
            <BezierCurveIcon size={18} weight="bold" />
          </div>
          <div>
            <div className="text-[15px] font-semibold tracking-[-0.02em]">AutoEval</div>
            <div className="text-[11px] text-[var(--sidebar-muted)]">Agent workbench</div>
          </div>
        </div>
        <nav
          aria-label="Primary"
          className="flex gap-1 overflow-x-auto px-3 pb-3 md:grid md:overflow-visible md:px-3 md:pb-0"
        >
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-10 shrink-0 items-center gap-2.5 rounded-[8px] px-3 text-[13px] font-medium transition-colors duration-150 ${
                  active
                    ? "bg-white/10 text-white"
                    : "text-[var(--sidebar-muted)] hover:bg-white/6 hover:text-white"
                }`}
              >
                <Icon size={17} weight={active ? "fill" : "regular"} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="absolute bottom-5 left-5 hidden text-[11px] text-[var(--sidebar-muted)] md:block">
          Local workspace
        </div>
      </aside>
      <main className="min-w-0">{children}</main>
    </div>
  );
}
