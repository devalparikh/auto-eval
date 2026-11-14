/** A browser auth transition invalidates every request and cached response. */
type ApiSession = { identity: string | null; generation: number; signal: AbortSignal };
let controller = new AbortController();
let session: ApiSession = { identity: "local", generation: 0, signal: controller.signal };
const listeners = new Set<() => void>();
export const getApiSession = () => session;
export function subscribeApiSession(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function transitionApiSession(identity: string | null) {
  const previous = controller;
  controller = new AbortController();
  session = { identity, generation: session.generation + 1, signal: controller.signal };
  previous.abort();
  for (const listener of listeners) listener();
}
export function apiSessionKey(key: string, current = session) {
  return JSON.stringify([current.identity, current.generation, key]);
}
