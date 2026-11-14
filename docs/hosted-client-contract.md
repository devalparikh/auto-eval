# Hosted instance and SDK configuration contract

**Confirmed target flow:** a private customer repo deploys a pinned public AutoEval
release to Vercel, with Supabase database/auth configured through environment
variables. That instance issues a hosted endpoint and per-app API keys. Lifty installs
the SDK from the public package registry published by the generic product repo,
initializes it from server environment variables pointing to the private instance,
and Deval views its dashboard through Supabase sign-in. This is the target, not a
claim that the current PR implements hosted onboarding. No alternative private
source access or maintainer-only installation path is permitted.

The [customer contract](customer-deployment-contract.md) governs repository ownership
and upstream migration authority. [Issue #27](https://github.com/devalparikh/auto-eval/issues/27)
tracks the missing public release/install/auth/migration capabilities. This document
chooses exact proposed configuration and scopes so future implementation has a
reviewable contract; it adds no runtime environment parser or hosted endpoints.

## Existing variables and current behavior

The existing FastAPI settings actually read `AUTOEVAL_ENV`, `AUTOEVAL_DATABASE_URL`,
`AUTOEVAL_HOSTED_PASSWORD`, `AUTOEVAL_ENFORCE_LOOPBACK_CLIENTS`, `AUTOEVAL_ALLOWED_HOSTS`,
`AUTOEVAL_WEB_ORIGINS` and `AUTOEVAL_TRACE_RETENTION_DAYS`. In production they require
the guarded hosted profile, including the current Basic password and non-SQLite
storage. The existing workbench retention default is 30 days; this is not the local
feed's separate default 24-hour TTL.

The current package uses explicit `createCapture` arguments and `startFeed` arguments,
not env loading. The Lifty integration reads only `NODE_ENV`/`VERCEL` to block deployed
synthetic capture; it does not read any proposed AutoEval client variables below.
It uses the local tarball, not a published registry release. The local receiver has
in-memory project-scoped `ingest`/`read`/`admin` credentials; it has no issuance UI,
Supabase login, persistent key registry, key expiry/rotation API or hosted storage.
Adding an unrecognized auth variable does not replace existing Basic authentication.

## Proposed instance environment (not implemented)

These names are part of the proposed **public product** contract, usable by every
customer. Values belong in private instance configuration/Vercel/Supabase, not upstream.

| Name                                    | Required target value / rule                                                                          | Current support                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `AUTOEVAL_ENV`                          | `production` for hosted                                                                               | Existing FastAPI setting                                                         |
| `AUTOEVAL_DATABASE_URL`                 | Supabase PostgreSQL connection URL with TLS, runtime least-privilege role; secret                     | Existing setting; least-privilege migration separation still needs upstream work |
| `AUTOEVAL_ENFORCE_LOOPBACK_CLIENTS`     | `false` only in the approved authenticated hosted profile                                             | Existing setting, not authorization by itself                                    |
| `AUTOEVAL_ALLOWED_HOSTS`                | Comma-separated exact instance hosts, no wildcard                                                     | Existing setting                                                                 |
| `AUTOEVAL_WEB_ORIGINS`                  | Exact HTTPS dashboard origin(s), no wildcard                                                          | Existing setting                                                                 |
| `AUTOEVAL_TRACE_RETENTION_DAYS`         | Explicit `1` for the proposed pilot; hosted observations and related copies need a reviewed lifecycle | Existing workbench setting; does not configure the new local feed                |
| `AUTOEVAL_AUTH_PROVIDER`                | `supabase` for this confirmed target                                                                  | Proposed; no auth-provider switch exists yet                                     |
| `AUTOEVAL_SUPABASE_URL`                 | Exact approved Supabase project HTTPS URL                                                             | Proposed                                                                         |
| `AUTOEVAL_SUPABASE_PUBLISHABLE_KEY`     | Supabase publishable key for sign-in, never a secret/service-role key                                 | Proposed                                                                         |
| `AUTOEVAL_AUTH_ALLOWED_SUBJECTS`        | Comma-separated allowed Supabase user UUIDs; absent/empty denies all dashboard/admin access           | Proposed; per-resource project authorization is still mandatory                  |
| `AUTOEVAL_PUBLIC_URL`                   | Exact HTTPS origin used for dashboard/callback and advertised API URL; no path/userinfo               | Proposed                                                                         |
| `AUTOEVAL_APP_KEY_MAX_AGE_DAYS`         | Default/max `90`, integer 1–90                                                                        | Proposed persistent key policy                                                   |
| `AUTOEVAL_APP_KEY_ROTATION_GRACE_HOURS` | Default/max `24`, integer 0–24                                                                        | Proposed normal rotation overlap; compromise always zero                         |
| `AUTOEVAL_MIGRATION_DATABASE_URL`       | Elevated connection used only by the pinned upstream migration job; secret, absent from app runtime   | Proposed public migration tooling; not an existing variable                      |

`AUTOEVAL_HOSTED_PASSWORD` remains required by today's guarded Basic profile. The
future release must implement and test Supabase auth on every applicable route before
changing that requirement. Do not remove it or disable existing protections as a
configuration workaround. No Supabase `service_role`/secret API key is needed by the
proposed dashboard login path; never send one to a browser. Runtime UI configuration
must expose only the publishable URL/key through a documented allowlisted bootstrap
response, not serialize environment variables. That runtime bootstrap is proposed
and avoids rebuilding a pinned UI artifact to bake in `NEXT_PUBLIC_*` values.

The server verifies the Supabase access token signature, expiry, expected issuer and
audience, then checks the allowlisted subject and resource/project authorization.
Use the configured project's documented verification/JWKS path, never a URL supplied
by the token. Signing-key cache/rotation and revocation behavior need integration
tests. User-editable metadata and a successful sign-in are not admin authorization.
Cookie-based mutations need CSRF/origin protection. The UI does not use an app API
key, and a publishable Supabase key alone is not a user identity.
[Supabase key types](https://supabase.com/docs/guides/api/api-keys) and
[JWT verification](https://supabase.com/docs/guides/auth/jwts) are the primary references.

## Proposed consuming application environment (not implemented)

Install an exact approved registry version of `@devalparikh/autoeval` and pin its
lockfile integrity; no `latest` in deployment builds. Namespace/version publication
is still gated. Initialize in server code only; apps own model and tool calls.

| Name                          | Target behavior / SDK mapping                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `AUTOEVAL_ENABLED`            | Strict `true`/`false`, default `false`; maps to `enabled`                                                                         |
| `AUTOEVAL_ENDPOINT`           | Full HTTPS ingestion URL issued by the instance, ending in `/v1/traces`; maps to `endpoint`; no credentials/query/fragment        |
| `AUTOEVAL_INGEST_KEY`         | Per-app, per-environment secret with only `traces:write`; maps to `token`                                                         |
| `AUTOEVAL_EXPERIMENT_ID`      | Registered immutable experiment UUID for this deployed code/prompt/config/model; maps to `experimentId`                           |
| `AUTOEVAL_SOURCE`             | Explicit `production` or `synthetic` when enabled; maps to `source`; never guess from missing config                              |
| `AUTOEVAL_REQUEST_TIMEOUT_MS` | Integer 10–2000, default `500`; maps to `timeoutMs`                                                                               |
| `AUTOEVAL_CONSENT_KEY`        | Separate per-app secret for trusted opt-in/withdrawal synchronization, only `grants:write`; not sent with trace capture           |
| `AUTOEVAL_READ_KEY`           | Optional per-app `traces:read` secret for a separately authorized reporting/CI process; not required or supplied to Lifty capture |

The app-owned structural projection policy and current authenticated consent are
explicit inputs in code, not environment-provided arbitrary field lists. Do not
put account IDs or experiment ownership into model arguments. The server derives
the app/project from the authenticated key; a payload cannot select another app.
For this contract each app maps to one isolated project; future grouping must not
weaken that binding. Register new experiments through an authorized operator/API,
not using the ingest key. Observation mode uses null dataset/case IDs; candidate
runs reference the same finalized manifest for comparison.

Missing or malformed enabled configuration must refuse capture with a sanitized
readiness/error status, never silently use a default host, token or production
source. The user's trainer response must still succeed independently of capture.
The current SDK can already take the corresponding explicit options, but the env
initializer and hosted Lifty path are **not built**; its deployed-runtime gate stays.
[hosted-app.env.example](templates/hosted-app.env.example) is a commented design-only
name inventory with capture false and secrets empty, not a working activation file.

## Per-app issuance, permissions and rotation (proposed)

An allowlisted operator signs in to the private dashboard, creates an app, selects
its approved projection/retention policy and registers an experiment. The instance
shows the ingestion URL and a newly issued key once. Only the key's digest and
metadata are stored: key ID, app/project, exact scope, issue/expiry/revocation times.
Use at least 32 random bytes for the token (base64url is compatible with the current
client); no identity-derived tokens. Do not log credentials or place them in URLs.

| Credential                | Allowed operations                                                                                                        | Explicitly denied                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `traces:write`            | Submit projected traces for its bound app with an active matching grant                                                   | Read/export, grants, experiment/dataset registration, key issuance, inference    |
| `grants:write`            | Create expiring grants and revoke/delete observations for its bound app after authenticated source opt-in/withdrawal      | Trace read/export, key issuance, experiment registration, inference              |
| `traces:read`             | Authorized trace/paired-result reads for its bound app                                                                    | Capture, consent changes, configuration, key issuance, inference                 |
| Supabase operator session | Authorized dashboard/admin operations within assigned projects, including issuance/revocation and experiment registration | Other projects, unapproved inference or automatic disclosure of participant data |

These named hosted scopes are proposed. Current local roles are `ingest`, `read`,
`admin`; the local receiver requires `admin` for grant registration/withdrawal and
must not be represented as already implementing a `grants:write` credential.
The separate consent key solves source consent synchronization without giving an
application an admin key. Source account-to-grant mapping stays inside the app;
withdrawal deletes server observations and prevents old-grant reuse. Neither a key
nor the operator's login substitutes for a participant's explicit opt-in.

Issue keys separately per app, environment and scope; no shared production/preview
key. Default/max lifetime is 90 days. For normal rotation issue a replacement of
the same scope, update the approved secret binding, verify authorized delivery, and
revoke the old key within at most 24 hours. That update/redeployment requires its
own approval; no change is made here. Compromise revokes immediately, with no grace.
Expired/revoked keys return 401; valid wrong-scope keys return 403; neither causes
an inference retry. Receiver authorization must check current revocation before
acceptance, with no cache that silently extends revoked access. Rotate consent and
read keys independently. Dashboard sign-out/session revocation is a separate flow.

## Local versus hosted

Today `eval:lifty`/`dev:autoeval` create ephemeral loopback endpoints and random
in-memory keys explicitly and use synthetic fixtures only. They read none of the
proposed client variables and never fall back to a hosted instance. The private
instance's Vercel environment and app's environment remain separate.

A future documented env initializer may use `http://127.0.0.1:<port>/v1/traces` only
for explicitly synthetic local development; hosted traffic requires the approved
HTTPS endpoint. Preview/local must not inherit production keys, grants, data or
experiment IDs. Dashboard access in the confirmed target is Supabase sign-in;
local feed tests are programmatic and do not prove that dashboard exists.

No repo, registry package, key issuance service, hosted database, environment setting,
secret or deployment was created by this contract update. All prior real-data
consent, retention, migration, publication and production approval gates remain.

## Numeric email OTP requirement (proposed)

Dashboard sign-in must use Supabase email one-time numeric codes, not magic-link-only
login. See [server release/auth boundary](server-release.md#hosted-email-otp-boundary--proposed-not-implemented).
The product owns request/verify UI, shouldCreateUser:false, session/JWT verification
and all protected API allowlist/resource checks. The instance owns email enrollment,
subject mapping and Supabase template/expiry/site/redirect settings. None of this is
implemented by release packaging or by setting proposed environment variables.
