"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiRequest } from "@/lib/api";
import { clearApiResourceCache } from "@/lib/use-api-resource";

export function AuthGate({
  enabled,
  emailLink = false,
  children,
}: {
  enabled: boolean;
  emailLink?: boolean;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<"loading" | "email" | "code" | "link" | "pending" | "ready">(
    enabled ? "loading" : "ready",
  );
  const [pendingSubject, setPendingSubject] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const callback = useRef<Promise<{authenticated?: boolean; status?: string; subject?: string}> | null>(null);
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
          setError("Sign-in link could not be verified. Request a new link and open it in the same browser.");
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
      .catch(() => {
        if (!controller.signal.aborted) setPhase("email");
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
        ) : phase === "link" ? (
          <div>
            <p role="status">If email delivery is available, a sign-in link will arrive shortly. Open it in the same browser that requested it.</p>
            <p>Email verification alone does not grant dashboard access.</p>
            <button onClick={() => setPhase("email")}>Request another link</button>
          </div>
        ) : phase === "pending" ? (
          <div>
            <h2>Approval pending</h2>
            <p>Your email is verified. Ask the instance operator to approve this user ID:</p>
            <p><code>{pendingSubject}</code></p>
            <p>Dashboard access requires separate approval. Sign in again after approval.</p>
            <button onClick={() => {
              clearApiResourceCache();
              setPendingSubject("");
              setPhase("email");
            }}>Return to sign in</button>
          </div>
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
                  If email delivery is available, a numeric code will arrive shortly.
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
                  ? (emailLink ? "Send sign-in link" : "Send code")
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
