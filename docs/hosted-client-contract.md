# Hosted instance and SDK contract

The candidate implements Supabase numeric email OTP, server-wide authorization,
app/environment scoped keys, PostgreSQL feed persistence, `/applications` dashboard,
paired synthetic comparisons, and explicit schema administration. It is not a
published release or evidence of a deployed instance. No cloud settings were changed.

## Instance settings actually read

| Setting | Value / behavior |
| --- | --- |
| `AUTOEVAL_ENV` | `production`; runtime refuses stale/unmigrated schema and does not seed/migrate |
| `AUTOEVAL_DATABASE_URL` | PostgreSQL SQLAlchemy URL (`postgresql+psycopg://…?sslmode=require`), backend runtime role |
| `AUTOEVAL_AUTH_MODE` | `supabase` on **both backend and frontend**; local default remains `local` |
| `AUTOEVAL_SUPABASE_URL` | Trusted project HTTPS origin, backend only |
| `AUTOEVAL_SUPABASE_PUBLISHABLE_KEY` | Publishable/anon key, backend only; never service-role key |
| `AUTOEVAL_OPERATOR_ALLOWLIST` | JSON mapping stable subject UUID to approved `email`, `role`, optional `resources` |
| `AUTOEVAL_SESSION_SECONDS` | 60–3600, default 900; capped by verified JWT expiry |
| `AUTOEVAL_ENFORCE_LOOPBACK_CLIENTS` | `false` only with configured authentication |
| `AUTOEVAL_ALLOWED_HOSTS` | Explicit nonlocal backend host names, comma separated |
| `AUTOEVAL_WEB_ORIGINS` | Exact HTTPS dashboard origin, comma separated |
| `AUTOEVAL_FEED_ALLOW_PRODUCTION` | Default false; separate review of participant consent and policy before true |
| `AUTOEVAL_TRACE_RETENTION_DAYS` | Existing workbench retention; feed retention is per application (1–30 days) |

Example shape (synthetic identities only):

```json
{"00000000-0000-4000-8000-000000000001":{"email":"operator@example.invalid","role":"admin"},"00000000-0000-4000-8000-000000000002":{"email":"reviewer@example.invalid","role":"viewer","resources":["00000000-0000-4000-8000-000000000003"]}}
```

An admin has instance-wide authority, including existing workbench/provider APIs.
A viewer can read only listed application resources; all existing workbench APIs
remain admin-only. Empty allowlists deny everyone. App/environment identity is one
immutable application UUID: use distinct IDs and keys for preview and production.
The old proposed `AUTH_PROVIDER`, `AUTH_ALLOWED_SUBJECTS`, `PUBLIC_URL`, key-age and
rotation-grace settings are **not** read. Use only the names above.

The legacy Basic preview remains supported via `AUTOEVAL_HOSTED_PASSWORD` (32+
characters in production); it cannot be combined with Supabase mode. Basic users
retain instance-admin authority and do not become scoped Supabase users. Local mode
remains loopback-only. Never disable network guards without authentication.

## OTP and session boundary

Pre-enroll approved users; disable open signup. Configure the Supabase email template
with `{{ .Token }}`, not magic-link-only `{{ .ConfirmationURL }}`. Review SMTP,
OTP expiry (suggested 600 seconds), code length (UI accepts 6–10 numeric digits), and
provider rate limits. Use asymmetric signing keys (RS256/ES256); legacy HS256 keys
are deliberately unsupported. Site URL is the exact dashboard HTTPS origin; numeric
OTP uses no callback and requires no invented wildcard redirect.

The server calls Supabase `/auth/v1/otp` with `create_user:false` (the REST equivalent
of `shouldCreateUser:false`) and `/verify` with `email`, numeric `token`, `type:email`.
It validates JWT signature, trusted issuer, audience `authenticated`, expiry and
required claims through the project's fixed JWKS URL, then asks `/user` for the
current verified email/subject. User metadata cannot grant roles. JWKS has a 60s
cache, no indefinite individual-key cache, and library unknown-kid refresh behavior.

The browser receives only a random opaque `__Host-autoeval` Secure/HttpOnly/Strict
cookie; its SHA-256 digest, subject/email and short expiry live in PostgreSQL. JWTs,
refresh tokens and codes are not persisted. There is no silent refresh: re-enter a
code after expiry. Every request rechecks the allowlist/email binding and session
expiry. Logout deletes the server session immediately. Removing an allowlist entry and rolling that configuration out to all workers
revokes its sessions on subsequent requests. Supabase account/signing-key changes
alone do not revoke an already-issued opaque session before its bounded expiry;
remove the subject allowlist entry for immediate instance-wide revocation.

All protected backend routes, including direct access, pass the central guard.
Public exceptions are minimal health, auth mode bootstrap, request and verification.
Cookie mutations require an exact allowed Origin, including login and logout.
App keys reject browser Origin/Sec-Fetch-Site and cannot access workbench endpoints.
Auth rate counters are durable and shared across workers (global, connection peer,
and hashed normalized email); forwarding headers are not trusted. OTP responses are
non-enumerating, including upstream failures. Provider SMTP/network failure therefore
looks like a sent request; verify delivery through approved provider operations.

## App keys and feed

In `/applications`, admins register an immutable app/environment/policy, issue
single-scope keys, list metadata, revoke, and rotate. Tokens have 32 random bytes,
are shown once, and only SHA-256 digests are stored. Default expiry is 30 days,
maximum 90. Rotation atomically revokes the old token and returns a same-scope
replacement; there is **no grace overlap**. For planned overlap issue a separate
key, update the app's secret binding, then revoke the old key explicitly.

| Scope | Allowed operations |
| --- | --- |
| `traces:write` | `POST /v1/traces` only, with active matching consent |
| `grants:write` | `POST /v1/grants`, `DELETE /v1/grants/{id}` |
| `traces:read` | `GET /v1/traces/{id}`, `GET /v1/comparisons/{left}/{right}` |

The same paths are available through the frontend service prefix `/api/backend`.
Thus an instance ingest endpoint is `https://<instance>/api/backend/v1/traces`.
Key expiry and revocation are checked against live rows on each operation; app row
locks serialize PostgreSQL ingestion with consent withdrawal and key changes.

Admin cookie APIs:
- `POST /api/applications` with `id,name,environment,policy,retention_days`.
- `POST /api/applications/{id}/keys` with `scope,expires_in_days`.
- `GET …/keys`; `POST …/keys/{keyId}/revoke` or `/rotate`.
- `POST …/datasets`: immutable `{schemaVersion:1,caseIds:[sorted SHA256s],rubricHash}`;
  returns content hash. This is a finalized external dataset, not a mutable draft.
- `POST …/experiments`: immutable SDK experiment contract, dataset hash required
  for scripted/live candidate runs; observed mode has null dataset/case IDs.
- `GET …/experiments`, `GET …/traces` and `GET …/comparisons/{left}/{right}`.

Use generated OpenAPI/types for exact validation. Experiment/dataset registration
is currently an authenticated API operation; it is not a hidden ingest privilege.
The dashboard displays up to 100 unexpired observations and compares named checks
only on complete, unique, synthetic case sets from the same frozen dataset/mode.
Missing/withdrawn/expired evidence rejects comparison; no aggregate quality claim.

Consent synchronization is owned by the source app's authenticated opt-in/withdrawal
flow. The server trusts only the separate `grants:write` key for that assertion;
never put it in browser code or let model arguments select consent. A grant is
`{id,source,expiresAt,policy:"metadata-v1"}`. Withdrawal creates a tombstone even for
an unknown ID and deletes its observations. A withdrawn ID cannot be reused.

Only explicitly allowlisted numeric metrics and boolean checks enter observations;
raw prompts, messages, outputs, identities and arbitrary metadata are rejected.
Production capture is off by default. Expiry is the earlier of event time + app
retention and grant expiry; retries cannot extend it. Reads filter expired rows;
startup/hourly maintenance and feed traffic physically purge expired observations.
Inactive/serverless instances need an operator-controlled maintenance schedule for
prompt physical deletion. Backups and app-side grant mappings require their own
retention/erasure policy. Grants/experiments/dataset provenance persist; per-kind
app storage is capped at 10,000 rows and app keys at 120 requests/minute.

## SDK environment initializer

```js
import { createCaptureFromEnv } from '@devalparikh/autoeval';
const capture = createCaptureFromEnv({
  policy: { metrics: ['latency_ms'], checks: ['passed'] }
});
// App inference happens independently. Supply authenticated consent explicitly:
await capture.capture({ consent, startedAt, endedAt,
  project: () => ({ metrics: { latency_ms }, checks: { passed } }) });
```

The initializer reads env only when called. `AUTOEVAL_ENABLED=true` is the only
activation value; otherwise capture is disabled. Enabled malformed configuration
throws a sanitized contract error at initialization; applications must contain
telemetry setup failures so inference remains independent.
`AUTOEVAL_ENDPOINT`, `AUTOEVAL_INGEST_KEY`, `AUTOEVAL_EXPERIMENT_ID`,
`AUTOEVAL_SOURCE`, `AUTOEVAL_REQUEST_TIMEOUT_MS` (10–2000, default 500) map directly
to explicit options. Consent and read keys belong to separate server integration
code; the capture initializer does not consume them. No provider credential is needed.

The package remains `0.1.0`, `private:true`, `UNLICENSED`, unpublished. Tests install
its packed tarball into an isolated consumer. Approved distribution plan: private
GitHub Packages prerelease, npm later. License, namespace permissions, version and
registry auth/access tests remain publication decisions; no license is invented.

Primary references: [Supabase passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless),
[JWT verification](https://supabase.com/docs/guides/auth/jwts),
[email templates](https://supabase.com/docs/guides/auth/auth-email-templates).

## Optional self-registration (pending approval)

`AUTOEVAL_ALLOW_SELF_REGISTRATION` defaults to `false`, preserving pre-enrollment.
An operator may explicitly set it to `true` on the backend and enable email signup
in Supabase for an instance that accepts registration requests. This changes only
`create_user` in the numeric OTP request. Configure **both** confirmation and
magic-link email templates with `{{ .Token }}` so new and returning users receive
a numeric code; the application does not consume magic links.

After signature/issuer/audience/expiry and current verified identity checks, an
unapproved caller receives only `{authenticated:false,status:"pending",subject}`.
No opaque session is created; any previous browser session is revoked. The UI
shows that caller's verified UUID and never mounts dashboard children. No pending
identity endpoint, role table, or schema migration is introduced. All protected
APIs still reject the caller. Invalid codes and unverified identities disclose no
subject. Disabling the flag restores the pre-enrolled-only verification behavior.

After explicit approval of the supplied UUID, the operator verifies its current
email in Supabase Auth and updates the backend's `AUTOEVAL_OPERATOR_ALLOWLIST`
with that exact UUID, email, and approved role/resources. Roll that configuration
out to every worker, then have the user sign in again. An empty map denies all
application access, including when registration is enabled. Supabase user metadata,
email verification, signup and SQL inserts do not grant application roles. There
is **no SQL approval command** under this environment-allowlist model; do not create
an admin SQL bypass. No email pre-enrollment is needed in opt-in registration mode.

## Optional built-in email-link sign-in (PKCE)

`AUTOEVAL_ALLOW_EMAIL_LINK_SIGN_IN=true` on both services opts into Supabase's
standard confirmation-link templates. Default remains false/numeric OTP. This
supports projects that cannot customize templates without custom SMTP.

The backend generates an S256 challenge and a ten-minute, Secure/HttpOnly,
SameSite=Lax `__Host-autoeval-pkce` verifier cookie. The fixed redirect is the
already allowed request Origin plus `/`; clients cannot submit redirect URLs.
Supabase's default confirmation URL recognizes the PKCE flow and returns a
one-use authorization code. Open the email link in the same browser that requested
it. The frontend removes the code from the URL, then exchanges it through the
same-origin backend. Callback responses use no-referrer/no-store headers.

The backend requires the exact allowed Origin, the verifier cookie and Supabase's
successful code/verifier exchange, then applies the existing JWT signature,
issuer/audience/expiry, current confirmed email and UUID/email allowlist checks.
Pending registration creates no application session and reveals only that user's
verified UUID. Approved users receive the same bounded opaque application cookie.
No access/refresh token is returned to the browser or stored by this application;
implicit token fragments are removed and rejected. No schema or SDK change.

Built-in Supabase mail is limited to organization team-member addresses and its
configured low send rate; do not describe this as general external delivery.
Custom SMTP and numeric-template customization can be configured later. Neither
email verification nor SQL user metadata grants dashboard access: a separately
approved UUID/email must be placed in `AUTOEVAL_OPERATOR_ALLOWLIST` and deployed
to all workers, followed by a new sign-in.

Provider references: [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow),
[default-link PKCE handling](https://github.com/supabase/auth/blob/master/internal/api/verify.go).
