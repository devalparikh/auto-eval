"use client";

import {
  CaretUpDownIcon,
  CheckIcon,
  GitBranchIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  SidebarSimpleIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  SunIcon,
} from "@phosphor-icons/react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useSpring,
} from "motion/react";
import Link, { useLinkStatus } from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { useHoverGlide } from "@/components/hover-glide";
import {
  isNavItemActive,
  modelsNavItems,
  pathForSystem,
  systemInitials,
  systemKeyFromPath,
  systemNavGroups,
  workspaceNavItems,
  type SidebarNavGroup,
  type SidebarNavItem,
} from "@/components/sidebar-nav";
import { systemByKey } from "@/features/catalog/catalog-options";
import type { ColorTheme } from "@/lib/theme";
import type { AgentSystemSummary } from "@/lib/types";
import { useCatalog } from "@/lib/use-catalog";

const tooltipGlide = { stiffness: 560, damping: 44, mass: 0.6 };
const TOOLTIP_HEIGHT = 28;

export function AppSidebar({
  pathname,
  collapsed,
  mobileOpen,
  sidebarRef,
  theme,
  soundEnabled,
  onToggleCollapsed,
  onCloseMobile,
  onToggleTheme,
  onToggleSound,
  onOpenCommandMenu,
}: {
  pathname: string;
  collapsed: boolean;
  mobileOpen: boolean;
  sidebarRef: RefObject<HTMLElement | null>;
  theme: ColorTheme;
  soundEnabled: boolean;
  onToggleCollapsed: () => void;
  onCloseMobile: () => void;
  onToggleTheme: () => void;
  onToggleSound: () => void;
  onOpenCommandMenu: () => void;
}) {
  const catalog = useCatalog();
  const systems = catalog.data?.agent_systems ?? [];
  const systemKey = systemKeyFromPath(pathname);
  const system = systemKey ? systemByKey(catalog.data, systemKey) : null;
  const [navigation, setNavigation] = useState({
    pathname,
    pendingHref: null as string | null,
  });

  // The new route commits a moment after the click. The highlight moves on the
  // click itself, so the sidebar answers before the page does.
  if (navigation.pathname !== pathname) {
    setNavigation({ pathname, pendingHref: null });
  }

  function handleNavigate(href: string) {
    setNavigation({ pathname, pendingHref: href });
    onCloseMobile();
  }

  const groups: SidebarNavGroup[] = [
    ...(systemKey
      ? systemNavGroups(systemKey, {
          runtime: system?.runtime,
          graphVersions: system?.versions.length,
          datasets: system
            ? catalog.data?.datasets.filter(
                (dataset) => dataset.agent_system_id === system.id,
              ).length
            : undefined,
        })
      : [
          {
            label: "Agent systems",
            items: systems.map((item) => ({
              href: `/systems/${encodeURIComponent(item.key)}`,
              label: item.name,
              icon: GitBranchIcon,
            })),
          },
        ]),
    { label: "Models", items: modelsNavItems },
  ];

  const activeHref =
    navigation.pendingHref ??
    [...groups.flatMap((group) => group.items), ...workspaceNavItems].find(
      (item) => isNavItemActive(item, pathname),
    )?.href ??
    null;
  const tooltipY = useSpring(0, tooltipGlide);
  const rowsKey = systemKey ? "system" : "workspace";
  const [tooltip, setTooltip] = useState({
    label: "",
    hovering: false,
    rowsKey,
  });

  function showTooltip(row: HTMLElement, bounds: DOMRect, jump: boolean) {
    const nextY = bounds.top + (bounds.height - TOOLTIP_HEIGHT) / 2;
    if (jump) tooltipY.jump(nextY);
    else tooltipY.set(nextY);
    setTooltip({ label: row.dataset.navLabel ?? "", hovering: true, rowsKey });
  }

  function hideTooltip() {
    setTooltip((current) => ({ ...current, hovering: false }));
  }

  return (
    <aside
      ref={sidebarRef}
      className="shell-sidebar"
      aria-label="Sidebar"
      data-mobile-open={mobileOpen}
    >
      <div className="shell-sidebar-head">
        <Link
          href="/"
          className="shell-brand"
          aria-label="AutoEval home"
          data-sound="navigate"
          onNavigate={onCloseMobile}
        >
          <span className="shell-brand-mark" aria-hidden="true">
            a/e
          </span>
          <span className="shell-brand-name shell-nav-label">AutoEval</span>
        </Link>
        <button
          type="button"
          className="shell-icon-button shell-collapse-toggle"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={`${collapsed ? "Expand" : "Collapse"} sidebar (⌘B or Ctrl+B)`}
          onClick={onToggleCollapsed}
        >
          <SidebarSimpleIcon size={16} aria-hidden="true" />
        </button>
      </div>

      <SidebarShortcuts
        onOpenCommandMenu={onOpenCommandMenu}
        onRowHover={showTooltip}
        onLeave={hideTooltip}
      />

      <SystemSwitcher
        systems={systems}
        current={system}
        pathname={pathname}
        onNavigate={onCloseMobile}
      />

      <SidebarNav
        groups={groups}
        rowsKey={rowsKey}
        workspace={workspaceNavItems}
        activeHref={activeHref}
        onNavigate={handleNavigate}
        onRowHover={showTooltip}
        onLeave={hideTooltip}
      />

      <motion.span
        className="shell-tooltip"
        style={{ y: tooltipY }}
        data-visible={
          collapsed && tooltip.hovering && tooltip.rowsKey === rowsKey
        }
        aria-hidden="true"
      >
        {tooltip.label}
      </motion.span>

      <div className="shell-sidebar-foot">
        <span
          className="shell-status"
          data-offline={Boolean(catalog.error)}
          aria-label={
            catalog.error
              ? "Local API unreachable"
              : "Local workspace connected"
          }
        >
          <span className="shell-status-dot" aria-hidden="true" />
          <span className="shell-nav-label">
            {catalog.error ? "api offline" : "loopback / local"}
          </span>
        </span>
        <div className="shell-sidebar-actions">
          <button
            type="button"
            className="shell-icon-button theme-toggle"
            aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`}
            title={`Use ${theme === "dark" ? "light" : "dark"} theme`}
            onClick={onToggleTheme}
          >
            {theme === "dark" ? <MoonIcon size={15} /> : <SunIcon size={15} />}
          </button>
          <button
            type="button"
            className="shell-icon-button sound-toggle"
            aria-label={
              soundEnabled
                ? "Turn interface sounds off"
                : "Turn interface sounds on"
            }
            aria-pressed={soundEnabled}
            title={soundEnabled ? "Sounds on" : "Sounds off"}
            onClick={onToggleSound}
          >
            {soundEnabled ? (
              <SpeakerHighIcon size={15} />
            ) : (
              <SpeakerSlashIcon size={15} />
            )}
          </button>
        </div>
      </div>

      <button
        type="button"
        className="shell-rail"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onToggleCollapsed}
      />
    </aside>
  );
}

/** Search sits above the system switcher: it does not belong to a system. */
function SidebarShortcuts({
  onOpenCommandMenu,
  onRowHover,
  onLeave,
}: {
  onOpenCommandMenu: () => void;
  onRowHover: (row: HTMLElement, bounds: DOMRect, jump: boolean) => void;
  onLeave: () => void;
}) {
  const { hovering, pillStyle, listProps } = useHoverGlide({
    rowSelector: "[data-nav-row]",
    onRow: onRowHover,
  });

  return (
    <nav
      aria-label="Shortcuts"
      className="shell-nav shell-nav-top"
      onPointerOver={listProps.onPointerOver}
      onPointerLeave={() => {
        listProps.onPointerLeave();
        onLeave();
      }}
    >
      <motion.span
        className="glide-pill"
        style={{ ...pillStyle, borderRadius: 9 }}
        data-visible={hovering}
        aria-hidden="true"
      />
      <button
        type="button"
        className="shell-nav-row"
        aria-label="Open command menu"
        data-nav-row
        data-nav-label="Search"
        onClick={onOpenCommandMenu}
      >
        <MagnifyingGlassIcon
          size={15}
          className="shell-nav-icon"
          aria-hidden="true"
        />
        <span className="shell-nav-label">Search</span>
        <kbd className="shell-nav-count" aria-hidden="true">
          ⌘K
        </kbd>
      </button>
    </nav>
  );
}

function SidebarNav({
  groups,
  rowsKey,
  workspace,
  activeHref,
  onNavigate,
  onRowHover,
  onLeave,
}: {
  groups: SidebarNavGroup[];
  rowsKey: string;
  workspace: SidebarNavItem[];
  activeHref: string | null;
  onNavigate: (href: string) => void;
  onRowHover: (row: HTMLElement, bounds: DOMRect, jump: boolean) => void;
  onLeave: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const { hovering, pillStyle, listProps } = useHoverGlide({
    rowSelector: "[data-nav-row]",
    rowsKey,
    onRow: onRowHover,
  });

  function renderRow(item: SidebarNavItem) {
    return (
      <NavRow
        key={item.href}
        item={item}
        active={item.href === activeHref}
        reduceMotion={Boolean(reduceMotion)}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <nav
      aria-label="Primary"
      className="shell-nav"
      onPointerOver={listProps.onPointerOver}
      onPointerLeave={() => {
        listProps.onPointerLeave();
        onLeave();
      }}
    >
      <motion.span
        className="glide-pill"
        style={{ ...pillStyle, borderRadius: 9 }}
        data-visible={hovering}
        aria-hidden="true"
      />
      {groups.map((group) => (
        <div key={group.label ?? "root"} className="shell-nav-group">
          {group.label ? (
            <p className="shell-nav-heading">
              <span>{group.label}</span>
            </p>
          ) : null}
          {group.items.map(renderRow)}
        </div>
      ))}
      <div className="shell-nav-group shell-nav-workspace">
        {workspace.map(renderRow)}
      </div>
    </nav>
  );
}

function NavRow({
  item,
  active,
  reduceMotion,
  onNavigate,
}: {
  item: SidebarNavItem;
  active: boolean;
  reduceMotion: boolean;
  onNavigate: (href: string) => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className="shell-nav-row"
      data-nav-row
      data-nav-label={item.label}
      data-sound="navigate"
      onNavigate={() => onNavigate(item.href)}
    >
      {active ? (
        <motion.span
          layoutId="shell-nav-active"
          layoutDependency={item.href}
          className="shell-nav-active"
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 520, damping: 42, mass: 0.7 }
          }
        />
      ) : null}
      <Icon size={15} className="shell-nav-icon" aria-hidden="true" />
      <span className="shell-nav-label">{item.label}</span>
      {item.count !== undefined ? (
        <span className="shell-nav-count" aria-hidden="true">
          {item.count}
        </span>
      ) : null}
      <NavPending />
    </Link>
  );
}

/** A thin bar on the row's leading edge while its route is still loading. */
function NavPending() {
  const { pending } = useLinkStatus();
  return (
    <span
      className="shell-nav-pending"
      data-pending={pending}
      aria-hidden="true"
    />
  );
}

function SystemSwitcher({
  systems,
  current,
  pathname,
  onNavigate,
}: {
  systems: AgentSystemSummary[];
  current: AgentSystemSummary | null;
  pathname: string;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusFirstItem = useRef(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    if (focusFirstItem.current) {
      focusFirstItem.current = false;
      menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    }
    function onPointerDown(event: globalThis.PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (!open || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [],
    );
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  }

  const products = Object.values(
    systems.reduce<Record<string, AgentSystemSummary[]>>((grouped, system) => {
      (grouped[system.product_key] ??= []).push(system);
      return grouped;
    }, {}),
  );
  const label = current?.name ?? "Choose a system";

  return (
    <div ref={rootRef} className="shell-switcher" onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="shell-switcher-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Switch agent system. Current: ${label}`}
        title={label}
        onClick={(event) => {
          // A keyboard click reports detail 0; a pointer click should not ring
          // the first item with focus.
          focusFirstItem.current = event.detail === 0 && !open;
          setOpen((value) => !value);
        }}
      >
        <span className="shell-switcher-mark" aria-hidden="true">
          {current ? systemInitials(current.name) : systems.length}
        </span>
        <span className="shell-nav-label shell-switcher-name">{label}</span>
        <CaretUpDownIcon
          size={13}
          className="shell-switcher-caret"
          aria-hidden="true"
        />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            ref={menuRef}
            role="menu"
            aria-label="Agent systems"
            className="shell-switcher-menu"
            initial={reduceMotion ? false : { opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              reduceMotion
                ? { opacity: 0, transition: { duration: 0 } }
                : { opacity: 0, y: -3, scale: 0.99 }
            }
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            {products.map((flows) => {
              const product =
                flows.find((flow) => flow.key === flow.product_key) ?? flows[0];
              return (
                <div key={product.product_key} role="none">
                  {flows.length > 1 ? (
                    <p className="shell-switcher-heading" role="none">
                      {product.name}
                    </p>
                  ) : null}
                  {flows.map((flow) => (
                    <Link
                      key={flow.id}
                      role="menuitem"
                      href={pathForSystem(pathname, flow.key, flow.runtime)}
                      className="shell-switcher-item"
                      aria-current={
                        flow.id === current?.id ? "true" : undefined
                      }
                      data-sound="navigate"
                      onNavigate={() => {
                        setOpen(false);
                        onNavigate();
                      }}
                    >
                      <span className="min-w-0 truncate">
                        {flows.length > 1 ? flow.flow_name : flow.name}
                      </span>
                      {flow.id === current?.id ? (
                        <CheckIcon size={12} weight="bold" aria-hidden="true" />
                      ) : null}
                    </Link>
                  ))}
                </div>
              );
            })}
            {products.length === 0 ? (
              <p className="shell-switcher-empty">No systems yet.</p>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
