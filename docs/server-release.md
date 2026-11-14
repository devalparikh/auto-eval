# Vercel server release contract (candidate implementation)

This is a separate deployable product artifact from the app runtime npm SDK.
No release exists yet. Packaging does not implement hosted auth/feed/UI/migrations
or make the current workbench safe for the proposed customer pilot.

## Build and verify without publishing

From an approved clean source archive/checkout, outside-output directory required:

```sh
python3 -m unittest discover -s scripts -p test_server_release.py -v
python3 scripts/server_release.py build --source . --output /tmp/autoeval-candidate --version 0.0.0-candidate --source-commit <full-reviewed-source-sha>
```

The last command's placeholder must be replaced by the actual reviewed source SHA.
It produces deterministic auto-eval-server.tar.gz, server-manifest.json,
server_release.py (standalone installer) and SHA256SUMS. The bundle allowlists
frontend source/public/build configuration/lockfile and backend source/entrypoint/
requirements/pyproject; excludes SDKs, envs, databases, caches and tests. The scanner
is a limited heuristic: inspect the complete inventory/bytes and run an independent
secret/license/dependency review before publication. No approved license currently
exists; packaging is not permission to redistribute.

Manifest schema 1 binds product, version, source, target, archive SHA-256 and each
member's SHA-256. It explicitly marks hosted feed, Supabase auth and production
readiness false, migration CLI/schema upgrade contract null. It is verification
metadata, not a fabricated migration compatibility guarantee. Python dependencies
are still bounded rather than fully locked; identical source bundle bytes do not
promise identical dependency resolutions or reproducible deploy output.

Installation (all values must come from an approved immutable release lock):

```sh
python3 server_release.py install --bundle auto-eval-server.tar.gz --manifest server-manifest.json --manifest-sha256 <approved-manifest-sha256> --destination /tmp/new-autoeval-stage --version <exact-version> --source-commit <full-source-sha>
```

The installer must itself be downloaded and checksum-verified before execution.
A hash from the same untrusted download is not a trust anchor: review and commit
installer/manifest digests through the consumer's approval process. Verify inventory,
identity and all bytes before extraction. Links, traversal, duplicate/unexpected
members, existing destinations and oversized expanded archives are rejected.
Extracted source belongs in disposable staging, never in the instance git history.

## Vercel build choice

Choose **Vercel remote service builds from the fully staged release directory**.
Vercel discovers vercel.json service roots before each service build. A root build
command that downloads missing frontend/backend files is too late. Preserve the
released root config and its Next.js/FastAPI roots and /api/backend routing. The
installer includes backend/main.py and requirements.txt required for discovery.

An eventual separately approved operator deploy submits the staged directory through
a pinned supported Vercel CLI, allowing Vercel to build both services. Do not connect
the configuration-only instance repo directly and expect service discovery to work.
No deploy command/workflow is executable here. GitHub Actions `deploy --prebuilt`
would require a verified multi-service Build Output API build and project settings;
that path is not implemented or claimed supported by this change. Local Next build
alone is not proof of Vercel discovery/deployment. Live Vercel service support and
account/project framework settings still need authorized validation.

References: https://vercel.com/kb/guide/vercel-services and
https://vercel.com/docs/cli/deploy (reviewed 2026-11-14).

## Release review and explicit publication gate

server-release.yml runs offline tests/build/install on PRs and manual dispatch;
it uploads only short-lived Actions evidence. It has read-only repository permission,
no tag-triggered publishing, release creation, registry or deploy step. It cannot
publish even if someone dispatches it. Do not dispatch during this task.

After merge and separate explicit Deval approval of exact version/source/bytes,
an authorized operator may create the versioned GitHub Release and upload the four
reviewed files unchanged. Approval must include license, release visibility, manifest
and installer hashes, dependency review, provenance and immutability policy. Do not
reuse or replace release assets under a consumed version. Pin each immutable asset URL
and both trust-anchor hashes in the instance lock. Protect release tags/enable immutable
releases where available; checksums do not themselves prevent a maintainer replacing
assets. Record build run/source identity and attestations when available. No provenance
attestation is fabricated here. Publication automation is intentionally deferred until
its protected approval environment is separately approved/configured.

## Hosted email OTP boundary — proposed, not implemented

Generic request-code/enter-code UI and auth enforcement belong in AutoEval, not the
instance. Supabase `signInWithOtp` defaults to magic-link email; the email template
must include `{{ .Token }}` for a numeric code. Product requests use
`options: { shouldCreateUser: false }`, followed by
`verifyOtp({ email, token, type: 'email' })`. Enrollment is operator-approved only.
Never log codes/sessions or treat requesting a code as authorization.

The product must validate token signature, issuer, audience, expiry and verified
identity, map approved email enrollment to stable Supabase subject IDs, then apply
server-side subject allowlisting and per-resource authorization on ALL protected
APIs (including direct backend access). UI guards alone are insufficient. Empty
allowlist denies access. App ingest/consent keys remain separately scoped; OTP users
cannot substitute their session for an ingest credential or vice versa. Sign-in and
health endpoints need narrowly documented exceptions, rate limiting, non-enumerating
errors, CSRF/session handling, revocation and denied-user tests. Existing Basic-auth
preview stays unchanged until this replacement is implemented and tested.

The instance owns allowed operator emails/subjects, Supabase email provider/template,
code length/expiry/rate settings and exact Site URL/Redirect URLs. No settings changed.
Primary docs: https://supabase.com/docs/guides/auth/auth-email-passwordless and
https://supabase.com/docs/guides/auth/auth-email-templates (reviewed 2026-11-14).
