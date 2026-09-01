# Vercel deployment

AutoEval now includes a fail-closed **single-user preview deployment** profile
for Vercel. This is not a multi-tenant production profile: one HTTP Basic
password protects the entire workbench, and Vercel Deployment Protection should
also be enabled for the project.

The root `vercel.json` declares the Next.js and FastAPI services and routes
`/api/backend/*` to FastAPI before sending all remaining traffic to Next.js.
The frontend uses `/api/backend/api` by default, while local Next.js development
proxies the same path to `localhost:8000`.

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
`backend/pyproject.toml`. Schema creation and the append-only migrations run in
the application lifespan and seed operations are idempotent.

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

1. Create a Vercel project from the repository and confirm that its account
   supports the multi-service `vercel.json` schema.
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
