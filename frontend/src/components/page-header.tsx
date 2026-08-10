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
    <header className="page-header">
      <div className="min-w-0">
        <p className="page-header-kicker">AutoEval / workspace</p>
        <h1 className="page-header-title">{title}</h1>
        <p className="page-header-description">{description}</p>
      </div>
      {action}
    </header>
  );
}
