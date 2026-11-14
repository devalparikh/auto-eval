"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiRequest } from "@/lib/api";
import { clearApiResourceCache } from "@/lib/use-api-resource";

export function AuthGate({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<"loading" | "email" | "code" | "ready">(
    enabled ? "loading" : "ready",
  );
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const unauthorized = () => {
      clearApiResourceCache();
      setPhase((current) => (current === "ready" ? "email" : current));
    };
    window.addEventListener("autoeval:unauthorized", unauthorized);
    const controller = new AbortController();
    apiRequest<{subject: string}>("/auth/session", { signal: controller.signal })
      .then((principal) => {
        if (!controller.signal.aborted) {
          if (!principal?.subject) throw new Error("Invalid session");
          clearApiResourceCache(principal.subject);
          setPhase("ready");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setPhase("email");
      });
    return () => {
      controller.abort();
      window.removeEventListener("autoeval:unauthorized", unauthorized);
      active.current?.abort();
    };
  }, [enabled]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      await apiRequest(phase === "email" ? "/auth/request" : "/auth/verify", {
        method: "POST",
        body: phase === "email" ? { email } : { email, token },
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        if (phase === "code") {
          clearApiResourceCache();
          const principal = await apiRequest<{subject: string}>("/auth/session", { signal: controller.signal });
          if (controller.signal.aborted) return;
          if (!principal?.subject) throw new Error("Invalid session");
          clearApiResourceCache(principal.subject);
        }
        setPhase(phase === "email" ? "code" : "ready");
        setToken("");
      }
    } catch {
      if (!controller.signal.aborted)
        setError(
          "Sign-in could not be completed. Check the code or request a new one.",
        );
      else
        setError(
          "The request timed out. Check your email before requesting another code.",
        );
    } finally {
      clearTimeout(timeout);
      setBusy(false);
    }
  }

  if (phase === "ready")
    return (
      <>
        {enabled && (
          <div className="page-actions">
            <a href="/applications">Applications</a>
            <button
              disabled={busy}
              onClick={async () => {
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
              }}
            >
              Sign out
            </button>
            {error && <p role="alert">{error}</p>}
          </div>
        )}
        {children}
      </>
    );
  return (
    <main
      className="page-container"
      style={{ maxWidth: 480, margin: "10vh auto" }}
    >
      <section className="surface-card" style={{ padding: 32 }}>
        <h1>Sign in to AutoEval</h1>
        {phase === "loading" ? (
          <p role="status">Checking session…</p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label>
              Email
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                disabled={busy || phase === "code"}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {phase === "code" && (
              <>
                <p role="status">
                  If this email is enrolled, a numeric code will arrive shortly.
                </p>
                <label>
                  Email code
                  <input
                    autoFocus
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6,10}"
                    required
                    value={token}
                    disabled={busy}
                    onChange={(event) => setToken(event.target.value)}
                  />
                </label>
              </>
            )}
            <button disabled={busy} type="submit">
              {busy
                ? "Working…"
                : phase === "email"
                  ? "Send code"
                  : "Verify code"}
            </button>
            {phase === "code" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPhase("email");
                  setToken("");
                  setError("");
                }}
              >
                Use another email or request a new code
              </button>
            )}
            {error && <p role="alert">{error}</p>}
          </form>
        )}
      </section>
    </main>
  );
}
