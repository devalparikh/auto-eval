"use client";

import {
  ArrowUpRightIcon,
  CaretDownIcon,
  GithubLogoIcon,
  MoonIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  SunIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";
import {
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from "react";
import { playUiSound, UI_SOUND_STORAGE_KEY, type UiSound } from "@/lib/sound";
import { THEME_COOKIE_NAME, type ColorTheme } from "@/lib/theme";

const SOUND_PREFERENCE_EVENT = "autoeval:sound-preference";

const MARKETING_NAV_ITEMS = [
  {
    key: "workflow",
    label: "workflow",
    href: "#workflow",
    description: "Trace one run and turn the useful failures into repeatable tests.",
    details: ["connect the agent", "inspect the trace", "save the cases", "compare models"],
  },
  {
    key: "trace",
    label: "trace",
    href: "#trace",
    description: "Open one run and see every node, model call, cost, and timing with the context that produced it.",
    details: ["span waterfall", "model calls and cost", "failed checks", "save to a dataset"],
  },
  {
    key: "connect",
    label: "connect",
    href: "#modular",
    description: "Keep your graph, handlers, scoring, and trace policy beside the agent.",
    details: ["plugin manifest", "graph definition", "handlers and scoring", "trace policy"],
  },
  {
    key: "compare",
    label: "compare",
    href: "#compare",
    description: "Run the same locked cases against every candidate and line up quality, cost, and latency.",
    details: ["one finalized dataset", "every model", "per-case results", "cost and latency"],
  },
  {
    key: "provenance",
    label: "provenance",
    href: "#provenance",
    description: "Pin every graph, prompt, dataset, model, and runtime snapshot before evaluation.",
    details: ["content hashes", "locked dataset", "pinned snapshots", "backend keys"],
  },
  {
    key: "questions",
    label: "questions",
    href: "#faq",
    description: "See how frameworks, providers, immutable datasets, and local operation work.",
    details: ["agent frameworks", "model providers", "dataset versions", "local operation"],
  },
] as const;

type MarketingNavKey = (typeof MARKETING_NAV_ITEMS)[number]["key"];

export function AppShell({
  children,
  initialTheme,
}: {
  children: ReactNode;
  initialTheme: ColorTheme;
}) {
  const pathname = usePathname();
  const systemKey = systemKeyFromPath(pathname);
  const navItems = scopedNavItems(systemKey);
  const [theme, setTheme] = useState(initialTheme);
  const reduceMotion = useReducedMotion();
  const soundEnabled = useSyncExternalStore(
    subscribeToSoundPreference,
    readSoundPreference,
    () => true,
  );

  function toggleSound() {
    const next = !soundEnabled;
    playUiSound(next ? "toggle-on" : "toggle-off");
    window.localStorage.setItem(UI_SOUND_STORAGE_KEY, String(next));
    window.dispatchEvent(new Event(SOUND_PREFERENCE_EVENT));
  }

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    document.cookie = `${THEME_COOKIE_NAME}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    if (soundEnabled) playUiSound("select");
  }

  function handleSound(event: MouseEvent<HTMLDivElement>) {
    if (!soundEnabled) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest(".sound-toggle")) return;

    const explicit = target.closest<HTMLElement>("[data-sound]")?.dataset
      .sound as UiSound | undefined;
    const sound = explicit ?? inferSound(target);
    if (sound) playUiSound(sound);
  }

  return (
    <div className="app-shell" onClickCapture={handleSound}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {pathname === "/" ? (
        <MarketingHeader theme={theme} onToggleTheme={toggleTheme} />
      ) : (
        <header className="shell-header">
          <Link
          href="/"
          className="shell-brand"
          aria-label="AutoEval home"
          data-sound="navigate"
        >
          <span className="shell-brand-mark" aria-hidden="true">
            a/e
          </span>
          <span className="shell-brand-name">AutoEval</span>
          <span className="shell-brand-version">v0.1</span>
        </Link>
        <nav aria-label="Primary" className="shell-nav">
          {navItems.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="shell-nav-link"
                data-sound="navigate"
              >
                <span className="shell-nav-index" aria-hidden="true">
                  {item.index}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="shell-controls">
          <span className="shell-status" aria-label="Local workspace connected">
            <span className="shell-status-dot" aria-hidden="true" />
            loopback / local
          </span>
          <button
            type="button"
            className="shell-icon-button theme-toggle"
            aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`}
            title={`Use ${theme === "dark" ? "light" : "dark"} theme`}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <MoonIcon size={16} /> : <SunIcon size={16} />}
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
            onClick={toggleSound}
          >
            {soundEnabled ? (
              <SpeakerHighIcon size={16} />
            ) : (
              <SpeakerSlashIcon size={16} />
            )}
          </button>
        </div>
        </header>
      )}
      <main id="main-content" className="route-frame">
        <motion.div
          key={pathname}
          className="route-content"
          initial={
            pathname !== "/" && !reduceMotion ? { opacity: 0.45 } : false
          }
          animate={{ opacity: 1 }}
          transition={{
            duration: reduceMotion ? 0 : 0.15,
            ease: [0.4, 1, 0.6, 1],
          }}
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}


function MarketingHeader({
  theme,
  onToggleTheme,
}: {
  theme: ColorTheme;
  onToggleTheme: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeItemKey, setActiveItemKey] =
    useState<MarketingNavKey>("workflow");
  const menuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();
  const activeItem =
    MARKETING_NAV_ITEMS.find((item) => item.key === activeItemKey) ??
    MARKETING_NAV_ITEMS[0];

  function keepMenuOpen() {
    if (menuCloseTimer.current) {
      clearTimeout(menuCloseTimer.current);
      menuCloseTimer.current = null;
    }
  }

  function scheduleMenuClose() {
    keepMenuOpen();
    menuCloseTimer.current = setTimeout(() => setMenuOpen(false), 180);
  }

  return (
    <header
      className="marketing-header"
      onMouseEnter={keepMenuOpen}
      onMouseLeave={scheduleMenuClose}
    >
      <Link
        href="/"
        className="marketing-brand"
        aria-label="AutoEval home"
        data-sound="navigate"
      >
        <span aria-hidden="true">a/e</span>
        <strong>AutoEval</strong>
      </Link>
      <nav
        aria-label="Landing page"
        className="marketing-nav"
        onKeyDown={(event) => {
          if (event.key === "Escape" && menuOpen) {
            event.preventDefault();
            setMenuOpen(false);
            triggerRef.current?.focus();
          }
          if (event.key === "ArrowDown" && event.target === triggerRef.current) {
            event.preventDefault();
            setMenuOpen(true);
            requestAnimationFrame(() => {
              document
                .querySelector<HTMLAnchorElement>(
                  "#marketing-product-menu .marketing-menu-list > a",
                )
                ?.focus();
            });
          }
        }}
        onBlur={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setMenuOpen(false);
          }
        }}
      >
        <button
          ref={triggerRef}
          type="button"
          className="marketing-nav-trigger"
          aria-expanded={menuOpen}
          aria-controls="marketing-product-menu"
          onMouseEnter={() => setMenuOpen(true)}
          onClick={() => {
            keepMenuOpen();
            setMenuOpen(true);
          }}
        >
          product
          <CaretDownIcon size={12} weight="bold" aria-hidden="true" />
        </button>
        <a
          className="marketing-nav-link"
          href="#workflow"
          onMouseEnter={() => setMenuOpen(false)}
        >
          workflow
        </a>
        <a
          className="marketing-nav-link marketing-github-link"
          href="https://github.com/devalparikh/auto-eval"
          target="_blank"
          rel="noreferrer"
          onMouseEnter={() => setMenuOpen(false)}
        >
          <GithubLogoIcon size={14} weight="regular" aria-hidden="true" />
          github
          <ArrowUpRightIcon size={11} weight="bold" aria-hidden="true" />
        </a>
        <AnimatePresence>
          {menuOpen ? (
            <motion.div
              id="marketing-product-menu"
              className="marketing-menu"
              onMouseEnter={keepMenuOpen}
              onMouseLeave={scheduleMenuClose}
              initial={
                reduceMotion
                  ? false
                  : { opacity: 0, y: -6, filter: "blur(6px)" }
              }
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={
                reduceMotion
                  ? { opacity: 0 }
                  : {
                      opacity: 0,
                      y: -4,
                      filter: "blur(4px)",
                      transition: {
                        duration: 0.16,
                        ease: [0.4, 0, 0.2, 1],
                      },
                    }
              }
              transition={{
                duration: reduceMotion ? 0 : 0.22,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <div className="marketing-menu-list">
                {MARKETING_NAV_ITEMS.map((item) => (
                  <a
                    key={item.key}
                    href={item.href}
                    onMouseEnter={() => setActiveItemKey(item.key)}
                    onFocus={() => setActiveItemKey(item.key)}
                    onClick={() => setMenuOpen(false)}
                  >
                    {activeItemKey === item.key ? (
                      <motion.span
                        className="marketing-menu-active"
                        layoutId="marketing-menu-active"
                        transition={
                          reduceMotion
                            ? { duration: 0 }
                            : {
                                type: "spring",
                                stiffness: 430,
                                damping: 34,
                              }
                        }
                      />
                    ) : null}
                    <span>{item.label}</span>
                    <ArrowUpRightIcon
                      size={13}
                      weight="bold"
                      aria-hidden="true"
                    />
                  </a>
                ))}
              </div>
              <div className="marketing-menu-preview">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={activeItem.key}
                    initial={
                      reduceMotion
                        ? false
                        : { opacity: 0, x: 8, filter: "blur(5px)" }
                    }
                    animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                    exit={
                      reduceMotion
                        ? { opacity: 0 }
                        : { opacity: 0, x: -5, filter: "blur(3px)" }
                    }
                    transition={{
                      duration: reduceMotion ? 0 : 0.2,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  >
                    <strong>{activeItem.label}</strong>
                    <p>{activeItem.description}</p>
                    <div>
                      {activeItem.details.map((detail) => (
                        <span key={detail}>{detail}</span>
                      ))}
                    </div>
                    <a href={activeItem.href} onClick={() => setMenuOpen(false)}>
                      open section
                      <ArrowUpRightIcon
                        size={12}
                        weight="bold"
                        aria-hidden="true"
                      />
                    </a>
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </nav>
      <div className="marketing-actions">
        <button
          type="button"
          className="marketing-theme theme-toggle"
          aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`}
          title={`Use ${theme === "dark" ? "light" : "dark"} theme`}
          onClick={onToggleTheme}
        >
          {theme === "dark" ? <MoonIcon size={15} /> : <SunIcon size={15} />}
        </button>
        <Link href="/systems" className="marketing-cta" data-sound="navigate">
          open autoeval <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </header>
  );
}

function inferSound(target: Element): UiSound | null {
  if (target.closest(".app-button")) return "press";
  if (target.closest(".data-row")) return "select";
  return null;
}

function readSoundPreference() {
  return window.localStorage.getItem(UI_SOUND_STORAGE_KEY) !== "false";
}

function subscribeToSoundPreference(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(SOUND_PREFERENCE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SOUND_PREFERENCE_EVENT, onChange);
  };
}

function systemKeyFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/systems\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function scopedNavItems(systemKey: string | null) {
  const workspace = {
    href: "/systems",
    label: "Workspaces",
    index: "00",
    exact: true,
  };
  if (!systemKey) return [workspace];
  const root = `/systems/${encodeURIComponent(systemKey)}`;
  return [
    workspace,
    { href: root, label: "Overview", index: "01", exact: true },
    { href: `${root}/run`, label: "Run", index: "02", exact: false },
    { href: `${root}/traces`, label: "Traces", index: "03", exact: false },
    { href: `${root}/datasets`, label: "Datasets", index: "04", exact: false },
    {
      href: `${root}/evaluations`,
      label: "Evaluate",
      index: "05",
      exact: false,
    },
    { href: `${root}/results`, label: "Results", index: "06", exact: false },
    {
      href: `${root}/artifacts`,
      label: "Artifacts",
      index: "07",
      exact: false,
    },
  ];
}
