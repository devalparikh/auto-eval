"use client";

import {
  CheckIcon,
  CopyIcon,
  EnvelopeSimpleIcon,
  HourglassMediumIcon,
  InfoIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { clearApiResourceCache } from "@/lib/use-api-resource";
import { HostedSessionContext } from "./hosted-session";
import styles from "./auth-gate.module.css";

type Phase = "loading" | "callback" | "email" | "code" | "link" | "pending" | "ready";
type Verification = { authenticated?: boolean; status?: string; subject?: string };

const APPROVED_NOTICE = "Your account is approved. Sign in again to open the dashboard.";
const EXPIRED_NOTICE =
  "Your approval request is no longer available in this browser. Sign in again to check its status.";

/**
 * A verified but unapproved registration is held by the backend in its own
 * HttpOnly cookie, separate from any session. Only the server's answer is
 * rendered: nothing about the pending identity is stored in the browser.
 */
function readPending(signal?: AbortSignal) {
  return apiRequest<Verification>("/auth/pending", { method: "POST", signal });
}

export function AuthGate({
  enabled,
  emailLink = false,
  children,
}: {
  enabled: boolean;
  emailLink?: boolean;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>(enabled ? "loading" : "ready");
  const [pendingSubject, setPendingSubject] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingCheck, setPendingCheck] = useState<"idle" | "checking" | "still" | "failed">("idle");
  // The server renders no host; the browser fills it in without a mismatch.
  const host = useSyncExternalStore(subscribeNever, readHost, () => "");
  const active = useRef<AbortController | null>(null);
  const callback = useRef<Promise<Verification> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const unauthorized = () => {
      clearApiResourceCache();
      setPhase((current) => (current === "ready" ? "email" : current));
    };
    window.addEventListener("autoeval:unauthorized", unauthorized);
    const controller = new AbortController();
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const hasCallback = code !== null || url.hash.includes("access_token=") || url.hash.includes("error=");
    if (hasCallback) {
      // Strip credentials/errors before any application request. Never persist
      // access/refresh tokens from legacy implicit redirects or exchange them.
      url.searchParams.delete("code");
      url.hash = "";
      window.history.replaceState(null, "", url.pathname + url.search);
      if (!callback.current) {
        clearApiResourceCache();
        callback.current = emailLink && code && /^[A-Za-z0-9_-]{16,256}$/.test(code)
          ? apiRequest("/auth/exchange", { method: "POST", body: { code } })
          : Promise.reject(new Error("Unsupported callback"));
      }
    }
    if (callback.current) {
      setPhase((current) => (current === "loading" ? "callback" : current));
      // One transport survives StrictMode's effect replay; each subscriber still
      // checks its own lifetime before rendering any identity/private children.
      callback.current.then(async (result) => {
        if (controller.signal.aborted) return;
        clearApiResourceCache();
        if (result.authenticated === false && result.status === "pending" && result.subject) {
          setPendingSubject(result.subject);
          setPhase("pending");
          return;
        }
        if (result.authenticated !== true) throw new Error("Invalid exchange");
        const principal = await apiRequest<{subject: string}>("/auth/session", { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!principal?.subject) throw new Error("Invalid session");
        clearApiResourceCache(principal.subject);
        setPhase("ready");
      }).catch(() => {
        if (!controller.signal.aborted) {
          setPhase("email");
          setError("This sign-in link couldn't be verified. It may have expired, been replaced by a newer link, or been opened in a different browser. Request a new link here.");
        }
      });
    } else apiRequest<{subject: string}>("/auth/session", { signal: controller.signal })
      .then((principal) => {
        if (!controller.signal.aborted) {
          if (!principal?.subject) throw new Error("Invalid session");
          clearApiResourceCache(principal.subject);
          setPhase("ready");
        }
      })
      .catch(async (failure: unknown) => {
        if (controller.signal.aborted) return;
        // No session. A reload while awaiting approval asks the server whether
        // this browser verified a still-pending identity; it grants nothing.
        if (failure instanceof ApiError && failure.status === 401) {
          try {
            const result = await readPending(controller.signal);
            if (controller.signal.aborted) return;
            if (result.status === "pending" && result.subject) {
              setPendingSubject(result.subject);
              setPhase("pending");
              return;
            }
            if (result.status === "approved") setNotice(APPROVED_NOTICE);
          } catch {
            if (controller.signal.aborted) return;
          }
        }
        setPhase("email");
      });
    return () => {
      controller.abort();
      window.removeEventListener("autoeval:unauthorized", unauthorized);
      active.current?.abort();
    };
  }, [enabled, emailLink]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const controller = new AbortController();
    active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const result = await apiRequest<{ authenticated?: boolean; status?: string; subject?: string }>(phase === "email" ? "/auth/request" : "/auth/verify", {
        method: "POST",
        body: phase === "email" ? { email } : { email, token },
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        if (phase === "code") {
          clearApiResourceCache();
          if (result?.authenticated === false && result.status === "pending" && result.subject) {
            setPendingSubject(result.subject);
            setToken("");
            setPhase("pending");
            return;
          }
          const principal = await apiRequest<{subject: string}>("/auth/session", { signal: controller.signal });
          if (controller.signal.aborted) return;
          if (!principal?.subject) throw new Error("Invalid session");
          clearApiResourceCache(principal.subject);
        }
        setPhase(phase === "email" ? (emailLink ? "link" : "code") : "ready");
        setToken("");
      }
    } catch {
      if (!controller.signal.aborted)
        setError(
          phase === "code"
            ? "That code didn't work. Check it and try again, or request a new one."
            : "Sign-in could not be started. Try again in a moment.",
        );
      else
        setError(
          `The request timed out. Check your email before requesting another ${emailLink ? "link" : "code"}.`,
        );
    } finally {
      clearTimeout(timeout);
      setBusy(false);
    }
  }

  async function signOut() {
    if (busy) return;
    setBusy(true);
    clearApiResourceCache();
    setPhase("loading");
    try {
      await apiRequest("/auth/logout", { method: "POST" });
      clearApiResourceCache();
      setPhase("email");
    } catch {
      setPhase("email");
      setError("Sign-out could not be confirmed. Sign in to try again.");
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setPhase("email");
    setToken("");
    setError("");
    setNotice("");
  }

  function leavePending(message = "") {
    clearApiResourceCache();
    setPendingSubject("");
    setPendingCheck("idle");
    setError("");
    setNotice(message);
    setPhase("email");
  }

  async function checkPending() {
    if (busy) return;
    setBusy(true);
    setPendingCheck("checking");
    try {
      const result = await readPending();
      if (result.status === "pending" && result.subject) {
        setPendingSubject(result.subject);
        setPendingCheck("still");
      } else leavePending(result.status === "approved" ? APPROVED_NOTICE : EXPIRED_NOTICE);
    } catch {
      setPendingCheck("failed");
    } finally {
      setBusy(false);
    }
  }

  async function returnToSignIn() {
    if (busy) return;
    setBusy(true);
    try {
      // Ends the server-held pending record, so a reload starts at sign-in.
      await apiRequest("/auth/pending", { method: "DELETE" });
    } catch {
      // The record still expires on its own and never grants access.
    } finally {
      setBusy(false);
      leavePending();
    }
  }

  const pendingMessage =
    pendingCheck === "still"
      ? "Still waiting for approval."
      : pendingCheck === "failed"
        ? "Approval status couldn’t be checked. Try again in a moment."
        : "";

  if (phase === "ready")
    return enabled ? (
      <HostedSessionContext.Provider value={{ signOut: () => void signOut(), signingOut: busy }}>
        {children}
      </HostedSessionContext.Provider>
    ) : (
      <>{children}</>
    );

  return (
    <SignInFrame host={host}>
      {phase === "loading" || phase === "callback" ? (
        <WorkingPanel
          title={phase === "callback" ? "Verifying your sign-in link" : "Checking your session"}
        />
      ) : phase === "link" ? (
        <StatePanel
          tone="info"
          icon={<EnvelopeSimpleIcon size={18} weight="duotone" aria-hidden="true" />}
          title="Check your email"
        >
          <p className={styles.lead} role="status">
            If <strong className={styles.address}>{email}</strong> can sign in, a link is on its way.
            Open it in the same browser that requested it.
          </p>
          <ul className={styles.notes}>
            <li>Use the newest link you requested in this browser, within 10 minutes. It may expire sooner.</li>
            <li>Access also needs approval from the instance operator.</li>
          </ul>
          <div className={styles.actions}>
            <button type="button" className="app-button secondary" onClick={startOver}>
              Request another link
            </button>
          </div>
        </StatePanel>
      ) : phase === "pending" ? (
        <StatePanel
          tone="warning"
          icon={<HourglassMediumIcon size={18} weight="duotone" aria-hidden="true" />}
          title="Approval pending"
        >
          <p className={styles.lead}>
            Your email is verified. An operator still needs to approve this account before the
            dashboard opens.
          </p>
          <SubjectCard subject={pendingSubject} />
          <p className={styles.hint}>
            Send this ID to the instance operator. This page stays available in this browser for a
            limited time. Once you’re approved, check again and sign in.
          </p>
          {pendingMessage && (
            <p className={styles.hint} aria-hidden="true">
              {pendingMessage}
            </p>
          )}
          <span className={styles.srOnly} role="status">
            {pendingMessage}
          </span>
          <div className={styles.actions}>
            <button
              type="button"
              className="app-button"
              disabled={busy}
              aria-busy={pendingCheck === "checking"}
              onClick={() => void checkPending()}
            >
              {pendingCheck === "checking" && <span className={styles.buttonSpinner} aria-hidden="true" />}
              {pendingCheck === "checking" ? "Checking…" : "Check again"}
            </button>
            <button
              type="button"
              className="app-button secondary"
              disabled={busy}
              onClick={() => void returnToSignIn()}
            >
              Return to sign in
            </button>
          </div>
        </StatePanel>
      ) : (
        <SignInForm
          phase={phase}
          emailLink={emailLink}
          email={email}
          token={token}
          busy={busy}
          error={error}
          notice={notice}
          onEmail={setEmail}
          onToken={setToken}
          onSubmit={() => void submit()}
          onStartOver={startOver}
        />
      )}
    </SignInFrame>
  );
}

const subscribeNever = () => () => {};
const readHost = () => window.location.host;

function SignInFrame({ host, children }: { host: string; children: ReactNode }) {
  return (
    <div className={styles.screen}>
      <header className={styles.brand}>
        <span className={styles.brandMark} aria-hidden="true">
          a/e
        </span>
        <span className={styles.brandName}>AutoEval</span>
      </header>
      <main id="main-content" className={styles.main}>
        <section className={`surface-card ${styles.card}`} aria-labelledby="auth-title">
          {children}
        </section>
        <p className={`mono ${styles.instance}`}>{host}</p>
      </main>
    </div>
  );
}

function Title({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  // A state that replaces the form moves focus to its heading, so a screen
  // reader announces where the user landed instead of losing focus with the
  // removed control.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <h1 id="auth-title" ref={ref} tabIndex={-1} className={styles.title}>
      {children}
    </h1>
  );
}

function WorkingPanel({ title }: { title: string }) {
  return (
    <div className={styles.working} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <h1 id="auth-title" className={styles.title}>
        {title}…
      </h1>
    </div>
  );
}

function StatePanel({
  tone,
  icon,
  title,
  children,
}: {
  tone: "info" | "warning";
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.panel}>
      <span className={styles.icon} data-tone={tone}>
        {icon}
      </span>
      <Title>{title}</Title>
      {children}
    </div>
  );
}

function SubjectCard({ subject }: { subject: string }) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (reset.current) clearTimeout(reset.current);
    },
    [],
  );
  async function copySubject() {
    if (reset.current) clearTimeout(reset.current);
    try {
      await navigator.clipboard.writeText(subject);
      setCopy("copied");
      reset.current = setTimeout(() => setCopy("idle"), 1600);
    } catch {
      setCopy("failed");
    }
  }
  return (
    <div className={styles.subject}>
      <div className={styles.subjectHead}>
        <span className={styles.label}>Your user ID</span>
        <button
          type="button"
          className={styles.copy}
          data-copied={copy === "copied"}
          aria-label="Copy user ID"
          onClick={() => void copySubject()}
        >
          {copy === "copied" ? (
            <CheckIcon size={12} weight="bold" aria-hidden="true" />
          ) : (
            <CopyIcon size={12} aria-hidden="true" />
          )}
          {copy === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      <code className={styles.subjectValue}>{subject}</code>
      <span className={styles.srOnly} role="status">
        {copy === "copied" ? "User ID copied" : copy === "failed" ? "Copy unavailable. Select the ID to copy it." : ""}
      </span>
      {copy === "failed" && (
        <span className={styles.hint} aria-hidden="true">
          Copy unavailable here. Select the ID to copy it.
        </span>
      )}
    </div>
  );
}

function SignInForm({
  phase,
  emailLink,
  email,
  token,
  busy,
  error,
  notice,
  onEmail,
  onToken,
  onSubmit,
  onStartOver,
}: {
  phase: "email" | "code";
  emailLink: boolean;
  email: string;
  token: string;
  busy: boolean;
  error: string;
  notice: string;
  onEmail: (value: string) => void;
  onToken: (value: string) => void;
  onSubmit: () => void;
  onStartOver: () => void;
}) {
  const code = phase === "code";
  const emailInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  // Focus follows the step: the email field on arrival or return, the code
  // field once a code is sent, and back to the field after a failed attempt
  // re-enables it. The two fields are keyed apart, so neither inherits the
  // other's DOM node or focus state.
  useEffect(() => {
    if (busy) return;
    (code ? codeInput : emailInput).current?.focus();
  }, [code, busy]);
  return (
    <div className={styles.panel}>
      {/* The code field takes focus itself, so neither heading claims it. */}
      <h1 id="auth-title" className={styles.title}>
        {code ? "Enter your code" : "Sign in to AutoEval"}
      </h1>
      {code ? (
        <p className={styles.lead} role="status">
          If <strong className={styles.address}>{email}</strong> can sign in, a code is on its way.
        </p>
      ) : (
        <p className={styles.lead}>
          {emailLink
            ? "Enter your email and we’ll send you a sign-in link."
            : "Enter your email and we’ll send you a one-time code."}
        </p>
      )}
      {notice && !error && (
        <div className={styles.notice} role="status">
          <InfoIcon size={15} weight="fill" aria-hidden="true" />
          <p>{notice}</p>
        </div>
      )}
      {error && (
        <div className={styles.error} role="alert">
          <WarningCircleIcon size={15} weight="fill" aria-hidden="true" />
          <p>{error}</p>
        </div>
      )}
      <form
        className={styles.form}
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {code ? (
          <div className="field">
            <label htmlFor="auth-code">Email code</label>
            {/* No maxLength: the browser would cut a pasted "12345 67890"
                before the spaces are removed. The pattern bounds the digits. */}
            <input
              key="code"
              ref={codeInput}
              id="auth-code"
              className={`app-input ${styles.codeInput}`}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6,10}"
              title="6 to 10 digits"
              required
              value={token}
              disabled={busy}
              onChange={(event) => onToken(event.target.value.replace(/\s+/g, ""))}
            />
          </div>
        ) : (
          <div className="field">
            <label htmlFor="auth-email">Email</label>
            <input
              key="email"
              ref={emailInput}
              id="auth-email"
              className={`app-input ${styles.input}`}
              type="email"
              required
              autoComplete="email"
              placeholder="name@example.com"
              value={email}
              disabled={busy}
              onChange={(event) => onEmail(event.target.value)}
            />
          </div>
        )}
        <button className={`app-button ${styles.submit}`} disabled={busy} type="submit">
          {busy && <span className={styles.buttonSpinner} aria-hidden="true" />}
          {busy
            ? code
              ? "Verifying…"
              : "Sending…"
            : code
              ? "Verify code"
              : emailLink
                ? "Send sign-in link"
                : "Send code"}
        </button>
        {code && (
          <button type="button" className={styles.textButton} disabled={busy} onClick={onStartOver}>
            Use another email or request a new code
          </button>
        )}
      </form>
    </div>
  );
}
