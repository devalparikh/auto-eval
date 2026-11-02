import type { Icon } from "@phosphor-icons/react";

export type CommandEntry = {
  id: string;
  title: string;
  section: string;
  icon: Icon;
  detail?: string;
  keywords?: string;
  /** Shown before anything is typed; everything else appears only when searched. */
  pinned?: boolean;
  href?: string;
  run?: () => void;
};

const RESULT_LIMIT = 30;

/**
 * Every word must match somewhere. A match in the title outranks one in its
 * section or detail, and a title that starts with the word outranks the rest.
 */
export function searchCommands(
  entries: CommandEntry[],
  query: string,
): CommandEntry[] {
  const needle = query.toLowerCase().trim();
  const words = needle.split(/\s+/).filter(Boolean);
  if (!words.length) return entries.filter((entry) => entry.pinned);

  return entries
    .map((entry) => {
      const title = entry.title.toLowerCase();
      const context =
        `${entry.section} ${entry.detail ?? ""} ${entry.keywords ?? ""}`.toLowerCase();
      if (!words.every((word) => `${title} ${context}`.includes(word))) {
        return { entry, score: 0 };
      }
      const exact = title === needle ? 100 : 0;
      return {
        entry,
        score: words.reduce(
          (sum, word) =>
            sum +
            (title.startsWith(word) ? 20 : title.includes(word) ? 12 : 3),
          exact,
        ),
      };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.entry.title.localeCompare(right.entry.title),
    )
    .slice(0, RESULT_LIMIT)
    .map(({ entry }) => entry);
}

/**
 * Results in the order they are drawn, so arrow keys follow what is on screen.
 * Sections keep the order in which their best result ranked.
 */
export function groupBySection(entries: CommandEntry[]): CommandEntry[] {
  const sections = new Map<string, CommandEntry[]>();
  for (const entry of entries) {
    const section = sections.get(entry.section);
    if (section) section.push(entry);
    else sections.set(entry.section, [entry]);
  }
  return [...sections.values()].flat();
}
