# Hosted instance and SDK contract

The candidate implements Supabase numeric email OTP, server-wide authorization,
app-scoped keys, PostgreSQL feed persistence, `/applications` dashboard,
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
| `AUTOEVAL_TRACE_RETENTION_DAYS` | Existing workbench retention; capture retention is per application (Keep by default, or 1–3650 days) |

Example shape (synthetic identities only):

```json
{"00000000-0000-4000-8000-000000000001":{"email":"operator@example.invalid","role":"admin"},"00000000-0000-4000-8000-000000000002":{"email":"reviewer@example.invalid","role":"viewer","resources":["00000000-0000-4000-8000-000000000003"]}}
```

An admin has instance-wide authority, including existing workbench/provider APIs.
A viewer can read only listed application resources; all existing workbench APIs
remain admin-only. Empty allowlists deny everyone. App identity is an immutable UUID. Use separate apps/keys for deployment isolation;
each experiment also binds its declared source.
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

## App keys and capture v2

Create an app by naming it and choosing a key lifespan (1–90 days in the portal).
One atomic create returns the app UUID and a one-time token. Only its SHA-256 digest
is stored. The `application:connect` key can register that app's policies,
experiments and consent grants, append traces/outcomes, withdraw grants and read
its own policy declarations for delayed events. It cannot read diagnostic content,
change settings, issue keys or reach workbench/provider/admin APIs. Browser-origin
key use is rejected. The app owns the authenticated consent assertion.

Expiration belongs to the key. Revocation is immediate; rotation optionally
schedules a precise overlap deadline, capped by the old expiry. No implicit grace.
The SDK stops sending after a 401 until reinitialized with a replacement key.
Keep keys backend-only. The endpoint remains an env value:
`https://INSTANCE/api/backend/v2/traces`.

Production capture and retention belong to the **app**, never the key. New apps
allow production and keep all evidence by default. The first successful SDK policy
sets the initially allowed privacy/content categories. Schema changes are accepted
and versioned automatically. Later category additions are omitted with
`not_authorized` until enabled in app settings and included in user consent;
unchanged fields continue. Changing retention before first registration does not
prevent first-policy setup. Existing migrated apps retain their finite retention,
with production disabled and legacy keys revoked; no privilege is silently widened.

App settings are at `/applications/{id}/settings`. The portal sends the loaded
settings fingerprint with its save; an intervening change returns conflict and
requires reload. Shortening retention applies to existing evidence. Lengthening
it cannot extend existing deadlines or restore deleted content. Diagnostic content
can be erased independently of summaries, outcomes and assessments. Old trace IDs
cannot receive replacement content after that erasure.

## Consent, privacy and evidence

Individual consent is resolved server-side by the app, **off by default**, and
passed to `capture.begin({consent})`. `AUTOEVAL_CONSENTED_USER_IDS` and
`AUTOEVAL_GRANTS_KEY` are removed. The same app key registers opaque consent grants;
no user identifiers or user hashes are sent. Consent scopes are immutable and
independent of policy versions. Widening/narrowing the user's choice creates a new
grant ID; revoke the previous one when withdrawing/narrowing. Revocation creates a
tombstone even for unknown IDs and deletes associated evidence. The app keeps a
durable pending withdrawal until the instance confirms it, including across outages.

Apps declare exact data shapes. Metrics are finite numbers or null; checks are
booleans or null; operational attributes are numbers, booleans or declared enums.
Content fields have exact recursive schemas and named privacy categories. App-side
projection/redaction runs first; the SDK removes common identifiers before sending,
and ingest checks again. Neither redaction pass promises anonymity or catches every
name/medical detail. Health and workout data remain sensitive. Admin-only content
reads are explicit; viewers see permitted summaries and operational evidence.

The instance rejects undeclared fields. Invalid/unauthorized/oversized optional
content is omitted with coverage, preserving summary measurements. Unknown cost
stays null. Steps are bounded and truncation counted. Late outcomes retain the
original trace's policy and expiry, with their own immutable IDs. A deleted/expired
trace cannot accept events. Stored versions are never rewritten to a newer policy.

For finite retention, reads hide expired data; startup/hourly maintenance and
capture/dashboard traffic purge it. Inactive serverless instances need an
operator-controlled maintenance schedule for prompt physical deletion. Backups and
app-side consent mappings need their own deletion handling. Keep is the approved
default; [retention follow-up](development-todos.md) tracks future optimization/privacy.
Declarations, grants, audit and minimal non-content erasure receipts persist.
Per-kind app storage is capped at 10,000 records, excluding permanent receipts;
keys are limited to 120 requests/minute. These limits fail closed; monitor SDK
status/coverage without logging payloads or secrets.


Consent generation ownership: the app retains a ledger of every active grant for
each user. Widening may keep older generations/history, but full withdrawal must
revoke all of them. Narrowing conservatively revokes all prior generations and
erases their evidence. A delayed outcome uses its reference's original grant,
resolved under the authenticated user's current enabled/scoped choice; a new grant
ID cannot be substituted for an older trace's grant.

## Identity and evaluation

The SDK and backend compute identical domain-separated SHA-256 fingerprints of
normalized declarations. A policy version covers field meanings, units, schema and
categories. An experiment includes that policy, source, code revision, prompt,
config/graph hashes and declared models. Observed experiments have no dataset/run
ID. Controlled scripted/live runs require a finalized dataset manifest and a unique
run UUID; provider mode remains separate from production provenance.

Formal comparisons require complete, unique synthetic cases from the same finalized
dataset and mode. Match fields by semantic ID and definition version/meaning/unit.
Added/removed fields are not comparable, redefined fields are not pooled, and absent
values stay unknown. Error/partial statuses fail rather than disappearing from the
denominator. Production observations guide diagnosis and case authoring; they do
not prove a causal improvement or automatically become finalized evaluation data.
Human assessments append immutable ratings with a scorer/rubric digest. The portal's
versioned rubric defaults every rating to unknown; it does not call a provider.

## SDK and administration

See the [package README](../packages/trace-feed/README.md) for the typed SDK API,
environment variables and candidate package installation, and the
[Lifty guide](lifty-integration.md) for the complete trainer integration.
Missing/invalid config disables capture without throwing. `begin`/`step` do no I/O;
`end`/`outcome` use a shared deadline of at most two seconds and no retries after the
reply. The host must retain the request with its supported after-response hook.
Registration and grants are cached per process; ingest always rechecks live authority.

The app portal creates keys and manages settings. Admin APIs retain finalized dataset
registration, trace review/assessments and comparisons. Observed experiment and
policy registration belong to the SDK; there is no manifest upload or browser-console
setup. Exact internal schemas are generated in OpenAPI. The SDK candidate is
`0.2.0-private.1`, UNLICENSED, targeting restricted GitHub Packages; nothing is
published by tests. The old SDK, v1 writes, separate grants/read keys, manual
experiment env ID and Node receiver have no compatibility window.

SDK-less clients are a future follow-up; the versioned backend contract leaves room for them.

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
shows that caller's verified UUID and never mounts dashboard children. All
protected APIs still reject the caller. Invalid codes and unverified identities
disclose no subject and create no record. Disabling the flag restores the
pre-enrolled-only verification behavior.

### Pending status across reloads

So a reload does not lose the verified UUID, verification of an unapproved
identity also stores a display-only record (migration 20,
`hosted_pending_registrations`: subject as primary key, unique SHA-256 digest of a
random value, verified email, expiry) and sets a separate `__Host-autoeval-pending` cookie (Secure,
HttpOnly, SameSite=Strict, Path=/). Properties:

- **Grants nothing.** Request authorization never reads this table or cookie; a
  pending value presented as the session cookie is an unknown session. Only
  `POST /api/auth/pending` (status) and `DELETE /api/auth/pending` (clear) read it.
  Both require the allowed Origin. A status check that presents a pending cookie
  shares the auth rate limits; one without it (every signed-out page load) returns
  `{authenticated:false}` without a lookup, so it cannot exhaust the sign-in budget.
- **Server-verified, not client-trusted.** The browser stores nothing about the
  identity; the UI renders only the server's answer, which reveals the subject to
  the browser that verified it and nothing to any other caller.
- **Bounded.** Lifetime is the shorter of the verified access token's expiry,
  `AUTOEVAL_SESSION_SECONDS`, and one hour. One record per subject, enforced by the
  primary key: a newer verification, from any browser, replaces it with an atomic
  `INSERT … ON CONFLICT (subject) DO UPDATE`, so concurrent verifications leave
  exactly one valid cookie. Expired rows are deleted on access.
- **Ended by** expiry, `DELETE /api/auth/pending` ("Return to sign in"), logout, a
  successful approved sign-in in that browser, disabling registration, or approval.
- **Approval** of the exact UUID and email turns the next status check into
  `{authenticated:false,status:"approved"}` and deletes the record. It does not
  create a session: the user verifies again and receives the normal opaque session.
- **Revocation** works as before: removing an allowlist entry rejects the next
  request on any existing session. A pending record cannot outlive the token it was
  verified with; it is not rechecked against the identity provider during that time,
  so it may display a since-deleted user's own UUID until it expires, and nothing
  else.

Rolling this out requires `autoeval-migrate upgrade --runtime-role <role>` before
the new server starts (the runtime refuses an older schema), so the runtime role
receives DML on the new table. No configuration change is needed.

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
verified UUID; it keeps the same display-only pending record as numeric OTP (see
above). Approved users receive the same bounded opaque application cookie.
No access/refresh token is returned to the browser or stored by this application;
implicit token fragments are removed and rejected. No SDK change.

Built-in Supabase mail is limited to organization team-member addresses and its
configured low send rate; do not describe this as general external delivery.
Custom SMTP and numeric-template customization can be configured later. Neither
email verification nor SQL user metadata grants dashboard access: a separately
approved UUID/email must be placed in `AUTOEVAL_OPERATOR_ALLOWLIST` and deployed
to all workers, followed by a new sign-in.

Provider references: [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow),
[default-link PKCE handling](https://github.com/supabase/auth/blob/master/internal/api/verify.go).
