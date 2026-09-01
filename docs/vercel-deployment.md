# Vercel deployment readiness

AutoEval is **not currently safe or operationally compatible with a public
Vercel deployment**. Do not add a `vercel.json` that publishes the backend yet.

The current application is a local, single-user workbench. Its security and
runtime boundaries are deliberate:

- the API has no authentication or authorization;
- the request guard rejects non-loopback clients by default;
- SQLite stores mutable application state on the local filesystem;
- evaluations continue in FastAPI background tasks in the API process; and
- traces may retain prompts, inputs, outputs, and provider error context.

Consequently, routing a public path such as `/api/backend/*` to the FastAPI
service would either fail because loopback enforcement is working, or require
disabling that enforcement and expose an unauthenticated control plane. Do not
set `AUTOEVAL_ENFORCE_LOOPBACK_CLIENTS=false` merely to make a hosted deployment
respond.

## Why the proposed configuration is not included

A multi-service configuration such as the following is not a complete
deployment design for this repository:

```json
{
  "services": {
    "frontend": { "root": "frontend", "framework": "nextjs" },
    "backend": { "root": "backend" }
  },
  "rewrites": [
    {
      "source": "/api/backend(/.*)?",
      "destination": { "type": "service", "service": "backend" }
    },
    {
      "source": "/(.*)",
      "destination": { "type": "service", "service": "frontend" }
    }
  ]
}
```

The rewrite makes the backend reachable but supplies none of the controls or
durable infrastructure the application requires. It also does not update the
frontend API base, whose default is the local URL
`http://localhost:8000/api`. Provider keys must never be moved into a
`NEXT_PUBLIC_*` variable to work around that boundary.

## Hosted-deployment prerequisites

Complete these as application changes before adding any public deployment
configuration:

1. **Authentication and authorization**
   - Authenticate every API request at the router boundary.
   - Authorize trace and artifact reads, all mutations, evaluation admission,
     and provider-backed inference separately.
   - Add CSRF protection for cookie-authenticated unsafe methods and retain an
     explicit origin allowlist.

2. **A fail-closed hosted profile**
   - Add a distinct hosted environment profile rather than weakening the local
     profile.
   - Refuse startup when authentication, allowed hosts, allowed origins, or
     other security-critical settings are missing.
   - Keep CLI providers unavailable in hosted processes.

3. **Durable storage**
   - Replace local SQLite with a supported durable database.
   - Add the database-specific migration and concurrency test coverage before
     changing the configured URL.
   - Add retention and deletion controls for trace and snapshot payloads.

4. **Durable evaluation execution**
   - Replace in-process FastAPI background tasks with an authenticated durable
     queue and worker.
   - Add global concurrency, request, model, item, and spend limits, plus
     idempotency or duplicate-run suppression.

5. **Hosted frontend/API wiring**
   - Prefer a same-origin server-side API boundary so the browser does not need
     a public backend origin setting.
   - If a public API origin is unavoidable, expose only its non-secret URL,
     configure exact origins and hosts, and test preflight and unsafe methods.
   - Verify CSP `connect-src`, security headers, request-size enforcement, and
     rate limiting at the deployed edge and application layers.

6. **Deployment verification**
   - Run `make verify` against the production build.
   - Add hosted integration tests for unauthenticated rejection, tenant or owner
     isolation, CSRF, origin enforcement, durable evaluation completion, and
     database persistence across separate invocations.
   - Review Vercel's current configuration schema and runtime documentation at
     implementation time rather than relying on an unvalidated configuration
     example.

## Safe option today

Run both services on loopback with `make dev`. A public, frontend-only marketing
site should be split from the workbench and must not link visitors into
non-functional `/systems` routes. That can be designed as a separate deployment
without publishing the AutoEval API or weakening its local protections.
