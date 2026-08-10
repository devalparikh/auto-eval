import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "@/lib/content-security-policy";

describe("content security policy", () => {
  it("keeps production scripts nonce-bound without unsafe eval", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "nonce-value",
      development: false,
      apiUrl: "https://api.example.test/v1",
    });
    expect(policy).toContain("script-src 'self' 'nonce-nonce-value' 'strict-dynamic'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("connect-src 'self' https://api.example.test");
  });

  it("allows unsafe eval only for the Next development runtime", () => {
    expect(
      buildContentSecurityPolicy({
        nonce: "dev",
        development: true,
        apiUrl: "http://localhost:8000/api",
      }),
    ).toContain("'unsafe-eval'");
  });
});
