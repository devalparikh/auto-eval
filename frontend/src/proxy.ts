import { NextRequest, NextResponse } from "next/server";
import { buildContentSecurityPolicy } from "@/lib/content-security-policy";
import { isLoopbackHost } from "@/lib/loopback-host";

const BACKEND_PREFIX = "/api/backend";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith(BACKEND_PREFIX)) {
    return guardBackend(request);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const development = process.env.NODE_ENV !== "production";
  const policy = buildContentSecurityPolicy({
    nonce,
    development,
    apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

/**
 * Runs before the `/api/backend` rewrite in next.config.ts forwards to the API
 * on loopback. The API then sees this server as its client, so its loopback and
 * trusted-host checks cannot stand in for these: refuse any request that did not
 * name this machine. On Vercel the platform routes `/api/backend` to the API
 * service, which requires its own authentication, and this path never runs.
 */
function guardBackend(request: NextRequest) {
  if (process.env.VERCEL || isLoopbackHost(request.headers.get("host"))) {
    return NextResponse.next();
  }
  return Response.json({ detail: "Remote clients are not allowed" }, { status: 403 });
}

export const config = {
  matcher: [
    "/api/backend/:path*",
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
