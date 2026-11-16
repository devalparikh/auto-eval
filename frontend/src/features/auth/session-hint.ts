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
 * gate's same-origin API calls. Absence is only trusted when the request says
 * it is not cross-site (`Sec-Fetch-Site`); otherwise the gate checks everything.
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
};

/** Without a hint the gate checks everything, as if every cookie were present. */
export const UNKNOWN_SESSION: SessionHint = { session: true, pending: true, callback: true };

/** Navigations whose request carries SameSite=Strict cookies when they exist. */
const COOKIES_SENT = new Set(["same-origin", "same-site", "none"]);

export function readSessionHint(
  hasCookie: (name: string) => boolean,
  callback: boolean,
  fetchSite: string | null,
): SessionHint {
  // Cross-site, or a browser that does not say: a missing cookie proves nothing.
  if (!fetchSite || !COOKIES_SENT.has(fetchSite)) return { ...UNKNOWN_SESSION, callback };
  return {
    session: hasCookie(SESSION_COOKIE),
    pending: hasCookie(PENDING_COOKIE),
    callback,
  };
}
