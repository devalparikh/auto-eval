import {
  BookOpenTextIcon,
  ChartBarIcon,
  CpuIcon,
  DatabaseIcon,
  FlaskIcon,
  GitBranchIcon,
  HouseSimpleIcon,
  PlayIcon,
  PulseIcon,
  StackIcon,
  UploadSimpleIcon,
  type Icon,
} from "@phosphor-icons/react";
import { docsGroups, docsPages } from "@/features/docs/docs-pages";

export type SidebarNavItem = {
  href: string;
  label: string;
  icon: Icon;
  exact?: boolean;
  count?: number;
};

export type SidebarNavGroup = {
  label: string | null;
  items: SidebarNavItem[];
};

export const modelsNavItems: SidebarNavItem[] = [
  { href: "/custom-models", label: "Custom models", icon: CpuIcon },
];

export const workspaceNavItems: SidebarNavItem[] = [
  { href: "/systems", label: "All systems", icon: StackIcon, exact: true },
  { href: "/import", label: "Import", icon: UploadSimpleIcon },
  { href: "/docs", label: "Docs", icon: BookOpenTextIcon },
];

export function systemKeyFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/systems\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Inside the docs the rows become the docs' own pages, the way they become a
 * system's pages inside a system. The workspace rows below still lead back.
 */
export function docsNavGroups(): SidebarNavGroup[] {
  return docsGroups.map((group) => ({
    label: group,
    items: docsPages
      .filter((page) => page.group === group)
      .map((page) => ({
        href: page.href,
        label: page.title,
        icon: page.icon,
        // /docs is the overview, not a prefix of every page.
        exact: page.slug === "",
      })),
  }));
}

/** The order is the workflow: build the agent, try it, then benchmark changes. */
export function systemNavGroups(
  systemKey: string,
  counts: { graphVersions?: number; datasets?: number } = {},
): SidebarNavGroup[] {
  const root = `/systems/${encodeURIComponent(systemKey)}`;
  return [
    {
      label: null,
      items: [
        { href: root, label: "Overview", icon: HouseSimpleIcon, exact: true },
      ],
    },
    {
      label: "Build",
      items: [
        {
          href: `${root}/artifacts`,
          label: "Graph & prompts",
          icon: GitBranchIcon,
          count: counts.graphVersions,
        },
      ],
    },
    {
      label: "Test",
      items: [
        { href: `${root}/run`, label: "Run", icon: PlayIcon },
        { href: `${root}/traces`, label: "Traces", icon: PulseIcon },
      ],
    },
    {
      label: "Benchmark",
      items: [
        {
          href: `${root}/datasets`,
          label: "Datasets",
          icon: DatabaseIcon,
          count: counts.datasets,
        },
        { href: `${root}/evaluations`, label: "Evaluate", icon: FlaskIcon },
        { href: `${root}/results`, label: "Results", icon: ChartBarIcon },
      ],
    },
  ];
}

export function isNavItemActive(
  item: Pick<SidebarNavItem, "href" | "exact">,
  pathname: string,
): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * Where switching systems lands: the same section of the other system. A
 * single record such as one trace has no counterpart, so it falls back to the
 * section's list.
 */
export function pathForSystem(pathname: string, systemKey: string): string {
  const root = `/systems/${encodeURIComponent(systemKey)}`;
  const section = pathname.match(/^\/systems\/[^/]+\/([^/]+)/)?.[1];
  return section ? `${root}/${section}` : root;
}

export function systemInitials(name: string): string {
  const words = name.split(/[\s_-]+/).filter(Boolean);
  const initials =
    words.length > 1 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? "").slice(0, 2);
  return initials.toUpperCase();
}

/**
 * Identity of the content frame. Moving between traces keeps the same frame so
 * the list beside them stays mounted; every other route gets a fresh one.
 */
export function routeContentKey(pathname: string): string {
  return pathname.replace(/^(\/systems\/[^/]+\/traces)\/.*$/, "$1");
}
