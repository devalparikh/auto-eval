import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Every route is dynamic (the root layout reads the CSP nonce), so by
    // default each click waits on the server, even back to a page just seen.
    // Pages here are thin shells: screens fetch their own data on mount, so a
    // cached payload is never stale data, and a revisit skips the round trip.
    staleTimes: { dynamic: 300 },
  },
  async redirects() {
    // The import guide became the docs. Temporary, so a browser does not
    // cache it forever if /guide is ever reused.
    return [{ source: "/guide", destination: "/docs/import", permanent: false }];
  },
  async rewrites() {
    if (process.env.VERCEL) return [];
    return [
      {
        source: "/api/backend/:path*",
        destination: "http://localhost:8000/:path*",
      },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
