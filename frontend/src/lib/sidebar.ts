export const SIDEBAR_COOKIE_NAME = "autoeval-sidebar";

export type SidebarState = "expanded" | "collapsed";

export function sidebarStateFromCookie(value: string | undefined): SidebarState {
  return value === "collapsed" ? "collapsed" : "expanded";
}

export function paneCookieName(paneId: string): string {
  return `autoeval-pane-${paneId}`;
}

export function paneCollapsedFromCookie(value: string | undefined): boolean {
  return value === "collapsed";
}
