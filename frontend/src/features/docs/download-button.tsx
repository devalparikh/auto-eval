"use client";

import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { downloadText } from "@/features/systems/import-starter";

export function DownloadButton({
  filename,
  content,
  mime,
  children,
}: {
  filename: string;
  content: string;
  mime?: string;
  children: string;
}) {
  return (
    <button
      type="button"
      className="app-button secondary"
      onClick={() => downloadText(filename, content, mime)}
    >
      <DownloadSimpleIcon size={14} aria-hidden="true" />
      {children}
    </button>
  );
}
