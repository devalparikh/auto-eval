"use client";

import {
  MoonIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  SunIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from "react";
import { playUiSound, UI_SOUND_STORAGE_KEY, type UiSound } from "@/lib/sound";
import { THEME_COOKIE_NAME, type ColorTheme } from "@/lib/theme";

const SOUND_PREFERENCE_EVENT = "autoeval:sound-preference";

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
  const [showInitialEntry, setShowInitialEntry] = useState(true);
  const soundEnabled = useSyncExternalStore(
    subscribeToSoundPreference,
    readSoundPreference,
    () => true,
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setShowInitialEntry(false), 520);
    return () => window.clearTimeout(timer);
  }, []);

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
      <main id="main-content" className="route-frame">
        <div
          key={pathname}
          className={`route-content ${
            showInitialEntry ? "route-content-initial" : "route-content-change"
          }`}
        >
          {children}
        </div>
      </main>
    </div>
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
    { href: `${root}/versions`, label: "Versions", index: "07", exact: false },
  ];
}
