> This page documents the legacy Basic preview. For the new Supabase hosted
> candidate and release installation use [SETUP.md](SETUP.md). Both profiles now
> require explicit migration before production startup. No deploy is authorized
> or performed by these instructions.

# Vercel deployment

AutoEval now includes a fail-closed **single-user preview deployment** profile
for Vercel. This is not a multi-tenant production profile: one HTTP Basic
password protects the entire workbench, and Vercel Deployment Protection should
also be enabled for the project.

The root `vercel.json` declares the Next.js and FastAPI services and routes
`/api/backend/*` to FastAPI before sending all remaining traffic to Next.js.
The frontend uses `/api/backend/api` by default, while local Next.js development
proxies the same path to `localhost:8000`.

The backend service declares `"entrypoint": "main:app"`, which the Python
runtime resolves against the service root: `backend/main.py` re-exports the
ASGI application from the installed `autoeval_api` package. A Python service
must name its entrypoint explicitly - the build fails with
`must specify an "entrypoint" for runtime "python"` when it is missing, because
the application lives in `backend/src/autoeval_api/` rather than at a filename
the runtime probes on its own.

## Required Vercel environment variables

Set all values for every Vercel environment that will run the workbench:

```dotenv
AUTOEVAL_ENV=production
AUTOEVAL_DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST/DATABASE?sslmode=require
AUTOEVAL_HOSTED_PASSWORD=<long-random-password>
AUTOEVAL_ENFORCE_LOOPBACK_CLIENTS=false
AUTOEVAL_ALLOWED_HOSTS=<deployment-hostname>
AUTOEVAL_WEB_ORIGINS=https://<deployment-hostname>
OPENROUTER_API_KEY=<optional-backend-only-key>
OPENROUTER_APP_URL=https://<deployment-hostname>
```

Generate `AUTOEVAL_HOSTED_PASSWORD` with a password manager or at least 32
random bytes. Never put it, database credentials, provider keys, or market-data
credentials in a `NEXT_PUBLIC_*` variable.

Production startup fails if the password is absent, SQLite is selected,
loopback enforcement is still enabled, or CLI providers are enabled. This makes
an incomplete deployment fail instead of silently publishing the local profile.

## Database

Provision a durable PostgreSQL database and put its SQLAlchemy URL in
`AUTOEVAL_DATABASE_URL`. The Python deployment installs the Psycopg driver from
`backend/pyproject.toml`. Production startup checks the schema only. Run the released `autoeval-migrate`
CLI separately as described in SETUP.md; no production demo seeding occurs.

Do not use SQLite on Vercel. Its local filesystem is not the workbench's durable
source of truth across separate hosted invocations.

## Authentication

The hosted API requires HTTP Basic authentication on every request. The username
is `autoeval`; the password is `AUTOEVAL_HOSTED_PASSWORD`. The challenge is
returned before request bodies, origins, or application routes are processed.
Use a private browser profile if the browser caches Basic credentials longer
than desired, and rotate the environment variable if a credential is exposed.

HTTP Basic is acceptable here only as a single-user preview behind HTTPS and
Vercel Deployment Protection. It is not account management, tenant isolation,
or authorization. A shared or public product still requires a real identity
provider and per-resource authorization.

## Evaluation behavior

Vercel functions cannot be treated as a durable background worker. Hosted
requests therefore reject evaluation creation when `run_in_background=true`.
Callers must submit `run_in_background=false`, which keeps execution attached to
the request. Keep datasets and model selections small enough for the configured
function duration.

A durable queue, worker recovery, admission limits, idempotency, and spend
limits remain required before this can support unattended or multi-user work.

## Deployment checklist

1. After separate deployment approval, submit the verified extracted release stage
   and confirm the account supports its multi-service `vercel.json` schema.
2. Provision PostgreSQL and configure every required environment variable above.
3. Enable Vercel Deployment Protection; do not rely on obscurity of the URL.
4. Deploy a preview first.
5. Open `/api/backend/api/health`, authenticate as `autoeval`, and confirm a 200
   response. Missing or incorrect credentials must return 401.
6. Open `/`, authenticate when challenged, and run an included example.
7. Redeploy and confirm the same database records remain available.
8. Confirm unsafe cross-origin requests are rejected and security headers remain
   present.
9. Run `make verify` locally before promoting the deployment.

## Remaining boundary

This work prepares a guarded single-user Vercel preview; it does not make
AutoEval a public SaaS application. Trace retention controls, durable evaluation
workers, rate and spend limits, user identities, authorization, and operational
monitoring remain deployment blockers for shared use.

## Preserved service prefix

Vercel Services forwards the original request path to the selected service
([routing contract](https://vercel.com/docs/services/routing)). The hosted
`backend/main.py` entrypoint removes the fixed `/api/backend` prefix before the
application's authorization middleware and routers run. Local ASGI entrypoints
remain unchanged. Direct backend paths receive the same authorization checks;
forwarded-prefix headers cannot select an alternate path. This is part of the
new server candidate and requires a new release pin before deployment.

## Hosted Python dependencies in Services

The backend service selects its existing `hosted` optional dependency extra with
`uv pip install '.[hosted]'`. Vercel executes this in its managed service virtual
environment. Its default `uv sync` uses `pyproject.toml` and omits optional extras
even when `requirements.txt` requests them. The resulting function otherwise
fails to import `psycopg` before startup. Project-level install overrides do not
configure individual Services.

This installs dependencies already declared by the product; it changes no schema,
auth policy, migration behavior, dependency bounds or license. See the official
[Services build-setting rules](https://vercel.com/kb/guide/vercel-services).
