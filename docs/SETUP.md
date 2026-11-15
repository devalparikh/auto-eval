# Install and configure a hosted instance

This describes the **unpublished candidate**. No release URL or checksum is available
yet. Keep instance release pins null until publication is separately approved.

1. Review the exact source and checks, license, SDK namespace/registry permissions,
   release visibility, immutable version and release bytes. Publish only after a
   separate approval. Private GitHub Packages is the SDK prerelease plan; npm is later.
2. Obtain the four approved server release assets; independently pin installer and
   manifest digests in the instance ledger. Follow [server-release.md](server-release.md)
   to verify/extract into a new disposable directory **before** Vercel discovers
   service roots. The instance repo contains config, not copied product code.
3. Create a dedicated empty PostgreSQL schema and separate migration owner/runtime
   login roles through approved provisioning. Do not use an existing Supabase schema
   containing unrelated tables. The product migration CLI refuses unversioned nonempty
   schemas. Disable Supabase Data API exposure for this schema; migrations also enable
   RLS and revoke browser/public grants. Never grant the runtime role to browser roles.
4. Install the released backend into an isolated environment:

   ```sh
   python3 -m venv /tmp/autoeval-runtime
   /tmp/autoeval-runtime/bin/pip install '/tmp/verified-stage/backend[hosted]'
   ```

   Bind `AUTOEVAL_DATABASE_URL` to the approved migration credential **only for the
   migration process**, with the dedicated schema's search path. After backup/target
   approval run the official installed CLI:

   ```sh
   /tmp/autoeval-runtime/bin/autoeval-migrate upgrade --runtime-role autoeval_runtime
   /tmp/autoeval-runtime/bin/autoeval-migrate status
   ```

   `autoeval_runtime` is an example existing role name, not auto-created. The CLI
   grants schema usage, DML and backend-only RLS policies; migration tables are
   SELECT-only. The role must not be superuser or bypass RLS. Runtime must not own
   tables or have DDL privileges. Never supply migration credentials to the app.
5. Migration version 19 supports fresh PostgreSQL baselining and subsequent ordered
   upgrades under a PostgreSQL advisory transaction lock. SQLite retains its legacy
   upgrade path. Migration entrypoint source digests are persisted/checked; reviewed
   release hashes cover helper/source bytes. Legacy SQLite versions are first
   fingerprinted during explicit CLI adoption, not retroactively authenticated.
   Runtime production checks exact version/digests and never runs DDL or seeds demo
   inference. Unknown/newer schemas or digest drift stop startup. Downgrades are not
   implemented; restore an approved backup into a separate target when necessary.
6. Configure Supabase numeric email OTP and verified email-to-subject enrollment as
   described in [hosted-client-contract.md](hosted-client-contract.md). Set only its
   documented env names. `AUTOEVAL_AUTH_MODE=supabase` must reach both services;
   the same-origin `/api/backend/api` frontend API default supports secure cookies.
   Do not override it to a cross-origin API. Keep Supabase keys backend-only.
7. After separate deployment approval, submit the fully staged release for Vercel
   remote service builds. No deploy command is run or automated here. Confirm actual
   multi-service routing and platform settings with synthetic acceptance before use.
8. Sign in, register an application/environment and policy, issue separate ingest,
   consent and optional read keys. Register immutable datasets/experiments via the
   documented admin APIs. Initialize the installed SDK from server environment.
   Never put any app key in `NEXT_PUBLIC_*` or browser code.
9. Verify synthetic sign-in, forbidden direct access, scoped ingestion/dashboard,
   key rotation/expiry, consent withdrawal and retention. Production collection
   remains disabled until participant consent, minimization, access and backup
   retention are independently approved. The domain app always owns inference.

Local development remains `make setup`, `make dev`, bound to loopback. No hosted
credentials or production observations are needed for `make verify`.

For signup followed by separate operator approval, use the optional
`AUTOEVAL_ALLOW_SELF_REGISTRATION=true` mode documented in
[the hosted contract](hosted-client-contract.md#optional-self-registration-pending-approval).
Keep `AUTOEVAL_OPERATOR_ALLOWLIST={}` until the verified UUID is explicitly approved.

When retaining Supabase's default link-only email templates, use the opt-in
PKCE email-link mode in [the hosted contract](hosted-client-contract.md#optional-built-in-email-link-sign-in-pkce)
on both services. Built-in delivery is for organization team addresses under the
configured low rate limit. Custom SMTP remains an optional later setup task;
request no SMTP credential when the operator has chosen the built-in sender.
