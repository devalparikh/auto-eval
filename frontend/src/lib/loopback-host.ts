/**
 * Whether a Host header names this machine: `localhost`, an IPv4 loopback
 * address, or `[::1]`, with or without a port.
 *
 * The local profile proxies `/api/backend/*` to the API on loopback, and the
 * proxy rewrites Host on the way, so the API's own trusted-host check never
 * sees the name the browser used. Checking it here stops a DNS-rebinding page
 * (any hostname that resolves to 127.0.0.1) from reading the workbench through
 * the proxy. It is not a substitute for binding the server to 127.0.0.1: a
 * client that can reach the port can send any Host it likes.
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  let hostname: string;
  try {
    // URL parsing normalises the forms an address can take (127.1, 0x7f.0.0.1).
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }
  if (hostname === "localhost" || hostname === "[::1]") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}
