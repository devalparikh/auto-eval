"use client";

import {
  CpuIcon,
  DatabaseIcon,
  GitBranchIcon,
  HouseSimpleIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  PulseIcon,
  SidebarSimpleIcon,
  SunIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  groupBySection,
  searchCommands,
  type CommandEntry,
} from "@/components/command-search";
import {
  modelsNavItems,
  pathForSystem,
  systemKeyFromPath,
  systemNavGroups,
  workspaceNavItems,
} from "@/components/sidebar-nav";
import { systemByKey } from "@/features/catalog/catalog-options";
import { docsPages, isDocsPath } from "@/features/docs/docs-pages";
import { api } from "@/lib/api";
import { countOf, shortId, textPreview } from "@/lib/format";
import type { ColorTheme } from "@/lib/theme";
import { useApiResource } from "@/lib/use-api-resource";
import { useCatalog } from "@/lib/use-catalog";

/**
 * The ⌘K menu. Nothing here runs until it is opened, so the landing page makes
 * no API calls for it. Search covers pages, systems, datasets, custom models,
 * and the current system's traces.
 */
export function CommandMenu({
  pathname,
  theme,
  sidebarCollapsed,
  onToggleTheme,
  onToggleSidebar,
  onClose,
}: {
  pathname: string;
  theme: ColorTheme;
  sidebarCollapsed: boolean;
  onToggleTheme: () => void;
  onToggleSidebar: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [highlight, setHighlight] = useState({ top: 0, height: 0 });

  const catalog = useCatalog();
  const systemKey = systemKeyFromPath(pathname);
  const system = systemKey ? systemByKey(catalog.data, systemKey) : null;
  const traces = useApiResource(
    system ? () => api.traces(system.id) : null,
    [system?.id],
    { cacheKey: system ? `traces:${system.id}` : null },
  );
  const customModels = useApiResource(api.customModels, [], {
    cacheKey: "custom-models",
  });

  const entries = useMemo<CommandEntry[]>(() => {
    const results: CommandEntry[] = [];
    if (systemKey) {
      const heading = system?.name ?? "This system";
      for (const group of systemNavGroups(systemKey, {
        runtime: system?.runtime,
      })) {
        for (const item of group.items) {
          results.push({
            id: item.href,
            title: item.label,
            section: heading,
            icon: item.icon,
            href: item.href,
            pinned: true,
          });
        }
      }
    }
    // Inside the docs their pages lead, as a system's pages do inside a system.
    const readingDocs = isDocsPath(pathname);
    for (const page of docsPages) {
      results.push({
        id: `docs:${page.slug}`,
        title: page.title,
        section: "Docs",
        detail: page.description,
        keywords: page.keywords,
        icon: page.icon,
        href: page.href,
        pinned: readingDocs,
      });
    }
    for (const item of [...modelsNavItems, ...workspaceNavItems]) {
      results.push({
        id: item.href,
        title: item.label,
        section: "Go to",
        icon: item.icon,
        href: item.href,
        pinned: true,
      });
    }
    results.push({
      id: "/",
      title: "Home",
      section: "Go to",
      icon: HouseSimpleIcon,
      href: "/",
      keywords: "landing",
    });
    for (const page of docsPages) {
      for (const section of page.sections) {
        results.push({
          id: `docs:${page.slug}#${section.id}`,
          title: section.title,
          section: "Docs",
          detail: page.title,
          icon: page.icon,
          href: `${page.href}#${section.id}`,
        });
      }
    }
    for (const item of catalog.data?.agent_systems ?? []) {
      results.push({
        id: `system:${item.key}`,
        title: item.name,
        section: "Agent systems",
        detail: item.description,
        icon: GitBranchIcon,
        href: pathForSystem(pathname, item.key),
      });
    }
    for (const dataset of catalog.data?.datasets ?? []) {
      const owner = catalog.data?.agent_systems.find(
        (item) => item.id === dataset.agent_system_id,
      );
      if (!owner) continue;
      results.push({
        id: `dataset:${dataset.id}`,
        title: dataset.name,
        section: "Datasets",
        detail: `${owner.name} · ${countOf(dataset.versions.length, "version")}`,
        icon: DatabaseIcon,
        href: `/systems/${encodeURIComponent(owner.key)}/datasets`,
      });
    }
    for (const model of customModels.data ?? []) {
      results.push({
        id: `model:${model.id}`,
        title: model.name,
        section: "Custom models",
        detail: `${model.base_model.split("/").at(-1)} · ${model.status}`,
        icon: CpuIcon,
        href: `/custom-models?${new URLSearchParams({ model: model.id })}`,
      });
    }
    for (const trace of traces.data ?? []) {
      results.push({
        id: `trace:${trace.id}`,
        title: textPreview(trace.request_input, system?.name),
        section: "Traces",
        detail: `${shortId(trace.id)} · ${trace.model_id.split("/").at(-1)} · ${trace.status}`,
        keywords: trace.id,
        icon: PulseIcon,
        href: `/systems/${encodeURIComponent(systemKey ?? "")}/traces/${trace.id}`,
      });
    }
    results.push(
      {
        id: "action:theme",
        title: `Use ${theme === "dark" ? "light" : "dark"} theme`,
        section: "Actions",
        keywords: "appearance mode color",
        icon: theme === "dark" ? SunIcon : MoonIcon,
        run: onToggleTheme,
        pinned: true,
      },
      {
        id: "action:sidebar",
        title: `${sidebarCollapsed ? "Expand" : "Collapse"} sidebar`,
        section: "Actions",
        keywords: "menu minimize hide",
        icon: SidebarSimpleIcon,
        run: onToggleSidebar,
        pinned: true,
      },
    );
    return results;
  }, [
    catalog.data,
    customModels.data,
    onToggleSidebar,
    onToggleTheme,
    pathname,
    sidebarCollapsed,
    system,
    systemKey,
    theme,
    traces.data,
  ]);

  const visible = useMemo(
    () => groupBySection(searchCommands(entries, query)),
    [entries, query],
  );

  // A modal dialog contains focus and restores it when closed, but not when it
  // is simply removed. A layout effect's cleanup runs while it is still attached.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
      if (dialog.open) dialog.close();
    };
  }, []);

  // One highlight glides between rows, for both the pointer and the arrow keys.
  useLayoutEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    if (!row) {
      setHighlight({ top: 0, height: 0 });
      return;
    }
    setHighlight({ top: row.offsetTop, height: row.offsetHeight });
    row.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, visible]);

  function choose(entry: CommandEntry | undefined) {
    if (!entry) return;
    onClose();
    if (entry.href) router.push(entry.href);
    else entry.run?.();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      // A modal underneath listens on the document for Escape.
      event.nativeEvent.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!visible.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((activeIndex + step + visible.length) % visible.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      choose(visible[activeIndex]);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="command-menu"
      aria-label="Command menu"
      onKeyDown={handleKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // The dialog has no padding, so only the backdrop lands on it directly.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <label className="command-input">
        <MagnifyingGlassIcon size={16} aria-hidden="true" />
        <input
          autoFocus
          type="text"
          role="combobox"
          aria-label="Search AutoEval"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={
            visible[activeIndex] ? `${listId}-${activeIndex}` : undefined
          }
          autoComplete="off"
          spellCheck={false}
          placeholder="Search pages, traces, datasets, models"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
        />
        <kbd>esc</kbd>
      </label>
      <div ref={listRef} id={listId} role="listbox" className="command-list">
        <span
          className="dropdown-highlight"
          aria-hidden="true"
          style={{
            height: highlight.height,
            opacity: highlight.height ? 1 : 0,
            transform: `translateY(${highlight.top}px)`,
          }}
        />
        {visible.map((entry, index) => {
          const EntryIcon = entry.icon;
          const showSection = entry.section !== visible[index - 1]?.section;
          const rowProps = {
            id: `${listId}-${index}`,
            role: "option",
            "aria-selected": index === activeIndex,
            className: "command-row",
            "data-index": index,
            onPointerMove: () => {
              if (index !== activeIndex) setActiveIndex(index);
            },
          } as const;
          const contents = (
            <>
              <EntryIcon size={15} aria-hidden="true" />
              <span className="command-row-text">
                <span>{entry.title}</span>
                {entry.detail ? <small>{entry.detail}</small> : null}
              </span>
              <span className="command-row-enter" aria-hidden="true">
                ↵
              </span>
            </>
          );
          return (
            <Fragment key={entry.id}>
              {showSection ? (
                <div className="command-section" role="presentation">
                  {entry.section}
                </div>
              ) : null}
              {entry.href ? (
                <Link
                  {...rowProps}
                  href={entry.href}
                  data-sound="navigate"
                  onNavigate={onClose}
                >
                  {contents}
                </Link>
              ) : (
                <button
                  {...rowProps}
                  type="button"
                  onClick={() => choose(entry)}
                >
                  {contents}
                </button>
              )}
            </Fragment>
          );
        })}
        {visible.length === 0 ? (
          <p className="command-empty">Nothing matches “{query.trim()}”.</p>
        ) : null}
      </div>
      <p className="sr-only" aria-live="polite">
        {countOf(visible.length, "result")}
      </p>
      <footer className="command-footer" aria-hidden="true">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> navigate
        </span>
        <span>
          <kbd>↵</kbd> open
        </span>
      </footer>
    </dialog>
  );
}
