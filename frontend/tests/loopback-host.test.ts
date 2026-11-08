import { describe, expect, it } from "vitest";
import { isLoopbackHost } from "@/lib/loopback-host";

describe("isLoopbackHost", () => {
  it("accepts the names and addresses of this machine, with or without a port", () => {
    for (const host of ["localhost", "localhost:3000", "127.0.0.1:3000", "127.1.2.3", "[::1]:3000", "LOCALHOST:3000", "127.1"]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it("rejects other hosts, including names that only resolve to loopback", () => {
    for (const host of [
      "192.168.1.20:3000",
      "0.0.0.0:3000",
      "evil.example:3000",
      "localhost.evil.example",
      "127.0.0.1.nip.io",
      "[::ffff:192.168.1.20]",
      "",
      null,
      undefined,
      "local host",
    ]) {
      expect(isLoopbackHost(host), String(host)).toBe(false);
    }
  });
});
