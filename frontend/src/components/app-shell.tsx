"use client";

import {
  ArrowUpRightIcon,
  CaretDownIcon,
  GithubLogoIcon,
  ListIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  SunIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandMenu } from "@/components/command-menu";
import { routeContentKey } from "@/components/sidebar-nav";
import { SIDEBAR_COOKIE_NAME, type SidebarState } from "@/lib/sidebar";
import { playUiSound, UI_SOUND_STORAGE_KEY, type UiSound } from "@/lib/sound";
import { THEME_COOKIE_NAME, type ColorTheme } from "@/lib/theme";

const SOUND_PREFERENCE_EVENT = "autoeval:sound-preference";

const MARKETING_NAV_ITEMS = [
  {
    key: "workflow",
    label: "workflow",
    href: "#workflow",
    description: "Trace one run, save the useful failures as tests, and benchmark every change.",
    details: ["connect the agent", "inspect the trace", "save the cases", "benchmark changes"],
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
    details: ["code plugin", "graph definition", "handlers and scoring", "trace policy"],
  },
  {
    key: "benchmark",
    label: "benchmark",
    href: "#compare",
    description: "Run the same locked cases against every model and graph version, then line up quality, cost, and latency.",
    details: ["one finalized dataset", "models and fine-tunes", "graph versions", "cost and latency"],
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
  initialSidebar,
}: {
  children: ReactNode;
  initialTheme: ColorTheme;
  initialSidebar: SidebarState;
}) {
  const pathname = usePathname();
  const isLanding = pathname === "/";
  const [theme, setTheme] = useState(initialTheme);
  const [sidebar, setSidebar] = useState(initialSidebar);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const contentKey = routeContentKey(pathname);
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileNavButtonRef = useRef<HTMLButtonElement>(null);
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

  const toggleSidebar = useCallback(() => {
    setSidebar((current) => {
      const next = current === "collapsed" ? "expanded" : "collapsed";
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
      return next;
    });
  }, []);

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const closeCommandMenu = useCallback(() => setCommandMenuOpen(false), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandMenuOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (isLanding) return;
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isLanding, toggleSidebar]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    sidebarRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const returnFocusTo = mobileNavButtonRef.current;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileNavOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      returnFocusTo?.focus();
    };
  }, [mobileNavOpen]);

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
    <div
      className="app-shell"
      data-surface={isLanding ? "landing" : "workbench"}
      data-sidebar={sidebar}
      onClickCapture={handleSound}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {isLanding ? (
        <MarketingHeader theme={theme} onToggleTheme={toggleTheme} />
      ) : (
        <>
          <div className="shell-mobile-bar">
            <button
              ref={mobileNavButtonRef}
              type="button"
              className="shell-icon-button"
              aria-label="Open navigation"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(true)}
            >
              <ListIcon size={18} aria-hidden="true" />
            </button>
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
            </Link>
            <button
              type="button"
              className="shell-icon-button"
              aria-label="Open command menu"
              onClick={() => setCommandMenuOpen(true)}
            >
              <MagnifyingGlassIcon size={17} aria-hidden="true" />
            </button>
          </div>
          <div
            className="shell-scrim"
            data-open={mobileNavOpen}
            aria-hidden="true"
            onClick={closeMobileNav}
          />
          <AppSidebar
            pathname={pathname}
            collapsed={sidebar === "collapsed"}
            mobileOpen={mobileNavOpen}
            sidebarRef={sidebarRef}
            theme={theme}
            soundEnabled={soundEnabled}
            onToggleCollapsed={toggleSidebar}
            onCloseMobile={closeMobileNav}
            onToggleTheme={toggleTheme}
            onToggleSound={toggleSound}
            onOpenCommandMenu={() => {
              closeMobileNav();
              setCommandMenuOpen(true);
            }}
          />
        </>
      )}
      {commandMenuOpen ? (
        <CommandMenu
          pathname={pathname}
          theme={theme}
          sidebarCollapsed={sidebar === "collapsed"}
          onToggleTheme={toggleTheme}
          onToggleSidebar={toggleSidebar}
          onClose={closeCommandMenu}
        />
      ) : null}
      <main id="main-content" className="route-frame">
        {/* No entrance animation: a page paints at full strength the moment it
            commits, so a switch never reads as a wait. */}
        <div key={contentKey} className="route-content">
          {children}
        </div>
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
        <Link
          className="marketing-nav-link"
          href="/docs"
          onMouseEnter={() => setMenuOpen(false)}
        >
          docs
        </Link>
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
                  : { opacity: 0, y: -4, filter: "blur(4px)" }
              }
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={
                reduceMotion
                  ? { opacity: 0, transition: { duration: 0 } }
                  : {
                      opacity: 0,
                      y: -3,
                      transition: {
                        duration: 0.12,
                        ease: [0.4, 0, 0.2, 1],
                      },
                    }
              }
              transition={{
                duration: reduceMotion ? 0 : 0.16,
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
                {/* The preview swaps on the hover itself. Waiting for the old
                    one to leave first made every pointer move lag. */}
                <motion.div
                  key={activeItem.key}
                  initial={reduceMotion ? false : { opacity: 0.4, x: 4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    duration: reduceMotion ? 0 : 0.14,
                    ease: [0.32, 0.72, 0, 1],
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
