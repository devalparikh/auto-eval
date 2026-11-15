# Capture v2 release and owner handoff

Implementation is prepared in three stack layers: backend, SDK, portal/docs.
Nothing in these PRs merges, deploys, publishes a package or creates a release.
Each of those actions needs Deval's explicit instruction. Lifty and instance owners
perform their own repository changes.

## Merge order after approval

1. Backend: immutable capture contract, migration 21, app keys/settings and evidence.
2. SDK: candidate `0.2.0-private.1`, consent-first local calls, bounded sends and
   original-policy outcome support. Includes the installed-package integration test.
3. Portal/docs: settings, rotation and trace review, plus the exact Lifty handoff.

Retarget each dependent PR to main after its base is merged, keep its actual changes
intact and rerun required CI on the resulting commits. Do not deploy intermediate
stack layers. No old-SDK compatibility window: PR 41 is an unmerged stopgap and no
live dependency was identified in the supplied consumer context. If owners identify
a live consumer before rollout, stop its removal rollout and resolve it explicitly.

## Separately approved server release and instance rollout

Choose the final merged source SHA and a new server release version. Run the existing
[server release process](server-release.md): build candidate bytes, verify archive/
manifest checksums and installation, then approve those exact bytes for publication.
CI candidate artifacts are evidence, not a release. Publish the approved pinned
public bundle only when requested.

The auto-eval-instance owner updates its pinned release version, source SHA and
manifest digest. Use a backup and a maintenance window; run the new bundle's
`autoeval-migrate upgrade --runtime-role <dedicated_runtime_role>` deliberately before
starting the new runtime. Migration 21 is appended, never edits earlier checksums,
adds settings/key/evidence metadata and revokes legacy-scope keys. Grant the runtime
role access to the new table through the migration command. Existing immutable
history remains. Runtime startup refuses an old schema.

Remove `AUTOEVAL_FEED_ALLOW_PRODUCTION`; no replacement instance env is required.
New app defaults are production on and Keep. Previously registered legacy apps are
backfilled conservatively (production off, old retention, no new content permission).
Create a new Lifty app through the portal or explicitly review that old app's settings
and issue a fresh key. Supabase/backend auth, browser-role RLS, service routing and
backend-only provider secrets remain unchanged.

A rolled-back old server cannot run against the newer schema contract. Plan rollback
as a separately verified prior bundle plus the matching backup/schema state, never
by deleting migration rows or changing shipped migration code. Capture may be safely
disabled in Lifty while owners reconcile a rollout failure.

## Approved SDK publication through Actions

Review `@devalparikh/autoeval@0.2.0-private.1` and its exact packed bytes. The package
has no runtime dependencies, is UNLICENSED and targets restricted GitHub Packages.
The owner must confirm namespace/package permissions and the intended license/access
before approving a merge. [SDK publishing](sdk-publishing.md) defines the automatic
main-push workflow, existing-version skip, built-in GITHUB_TOKEN access, exact
tarball validation and source/checksum evidence. Only merge when Deval explicitly
asks; merging a package change authorizes publication of an absent version.
The manual fallback is workflow_dispatch on main, never local/PAT publication.
No manual publication of `0.2.0-private.1` occurred. Verify a clean consumer can
install the pinned version with a read-only package token and committed integrity
lockfile, and verify intended access boundaries separately. Local tarball tests
and metadata checks do not establish registry-install or visibility guarantees.

## Lifty owner work

Follow [lifty-integration.md](lifty-integration.md): install the pinned SDK after the
instance supports it, replace the PR 41 wrapper/console setup, add default-off
per-user consent and durable withdrawal handling, persist opaque references, and
instrument the trainer's inference and persistence boundaries. Include late outcome
hooks and reviewed redaction for selected workout/body-scan evidence. Remove the old
env allowlist, grants key and manual experiment ID. Test JSON/SSE and deployed
serverless lifecycle with the instance down before enabling Deval's opt-in account.

## Acceptance before real data

Use synthetic fixtures to verify no-consent no-op, first policy registration,
source separation, later category omission, key expiry/overlap/revocation, original
policy outcomes, content erasure, consent withdrawal and full bundle/migration paths.
Confirm admin-only content reads and viewer boundaries. Check post-response deadlines
and status-only diagnostics, with missing cost remaining unknown. Only then use
Deval's explicit in-app consent. Retention remains Keep; the optimization/privacy
review is tracked in [development-todos.md](development-todos.md).
