"use client";

import { SidebarSimpleIcon } from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";
import { paneCollapsedFromCookie, paneCookieName } from "@/lib/sidebar";

/**
 * A collapsible side pane beside the main content, for list-and-detail screens.
 * `narrow` chooses what a small viewport shows, where the two cannot sit side
 * by side: only the pane, only the main content, or the pane stacked above it.
 */
export function SplitPane({
  id,
  label,
  initialCollapsed,
  narrow = "stack",
  pane,
  children,
}: {
  id: string;
  label: string;
  initialCollapsed: boolean;
  narrow?: "pane" | "main" | "stack";
  pane: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(
    () => paneCollapsedInBrowser(id) ?? initialCollapsed,
  );
  const paneId = useId();

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      document.cookie = `${paneCookieName(id)}=${next ? "collapsed" : "expanded"}; Path=/; Max-Age=31536000; SameSite=Lax`;
      return next;
    });
  }, [id]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  const action = `${collapsed ? "Show" : "Hide"} ${label.toLowerCase()}`;

  return (
    <div className="split-pane" data-collapsed={collapsed} data-narrow={narrow}>
      <aside
        id={paneId}
        aria-label={label}
        className="split-pane-side"
        inert={collapsed}
      >
        <div className="split-pane-side-inner">{pane}</div>
      </aside>
      <div className="split-pane-main">
        <button
          type="button"
          className="shell-icon-button split-pane-toggle"
          aria-label={action}
          aria-expanded={!collapsed}
          aria-controls={paneId}
          title={`${action} (⌘\\ or Ctrl+\\)`}
          onClick={toggle}
        >
          <SidebarSimpleIcon size={16} aria-hidden="true" />
        </button>
        {children}
      </div>
    </div>
  );
}

/**
 * Visited routes are served from the router cache, so `initialCollapsed` can be
 * the cookie from an earlier visit. The browser's cookie is always current, and
 * on the first load it is the one the server read, so hydration still matches.
 */
function paneCollapsedInBrowser(id: string): boolean | null {
  if (typeof document === "undefined") return null;
  const prefix = `${paneCookieName(id)}=`;
  const entry = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(prefix));
  return entry === undefined
    ? null
    : paneCollapsedFromCookie(entry.slice(prefix.length));
}
