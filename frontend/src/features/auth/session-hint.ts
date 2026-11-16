/**
 * What the page's server knows about hosted sign-in before any API call:
 * which auth cookies came with the request (the API sets them HttpOnly on this
 * same origin, so browser code cannot see them) and whether the URL is an
 * email-link return.
 *
 * Presence only decides whether a check is worth making: with no session
 * cookie, `/auth/session` can only answer 401, so the gate renders sign-in on
 * the server instead of waiting on the API. A cookie that is present proves
 * nothing; the API still verifies it.
 *
 * Both cookies are SameSite=Strict, so a navigation from another site arrives
 * without them even when they exist; the browser still sends them on the
 * gate's same-origin API calls. So absence is read with `Sec-Fetch-Site`:
 * - `same-origin` / `same-site`: the cookies would have come, so absence holds.
 * - `none` (typed, bookmarked): usually reliable, but a browser-initiated
 *   redirect from another site keeps `none` while dropping Strict cookies.
 *   Sign-in still renders at once, and `confirm` asks the gate to check the
 *   session in the background and switch only if the API verifies one.
 * - cross-site or not stated: absence proves nothing; the gate checks first.
 *
 * The cookie names must match backend/src/autoeval_api/services/hosted_auth.py
 * (tests/session-hint.test.ts reads it).
 */
export const SESSION_COOKIE = "__Host-autoeval";
export const PENDING_COOKIE = "__Host-autoeval-pending";
/** Set by proxy.ts on a request whose URL carries an email-link `code`. */
export const CALLBACK_HEADER = "x-autoeval-auth-callback";

export type SessionHint = {
  session: boolean;
  pending: boolean;
  callback: boolean;
  /** No cookie arrived, but one may exist: verify in the background. */
  confirm: boolean;
};

/** Without a hint the gate checks everything, as if every cookie were present. */
export const UNKNOWN_SESSION: SessionHint = {
  session: true,
  pending: true,
  callback: true,
  confirm: false,
};

/** Navigations whose request carries SameSite=Strict cookies when they exist. */
const COOKIES_SENT = new Set(["same-origin", "same-site", "none"]);

export function readSessionHint(
  hasCookie: (name: string) => boolean,
  callback: boolean,
  fetchSite: string | null,
): SessionHint {
  // Cross-site, or a browser that does not say: a missing cookie proves nothing.
  if (!fetchSite || !COOKIES_SENT.has(fetchSite)) return { ...UNKNOWN_SESSION, callback };
  const session = hasCookie(SESSION_COOKIE);
  const pending = hasCookie(PENDING_COOKIE);
  return {
    session,
    pending,
    callback,
    confirm: fetchSite === "none" && !session && !pending,
  };
}
