import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex min-h-[72px] items-center justify-between gap-6 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4 md:px-7">
      <div className="min-w-0">
        <h1 className="text-[18px] font-semibold tracking-[-0.025em]">{title}</h1>
        <p className="mt-0.5 truncate text-[12px] text-[var(--text-muted)]">{description}</p>
      </div>
      {action}
    </header>
  );
}
