# Product and customer deployment contract

**Decision:** AutoEval is the generic product. Every operator, including its author,
consumes it through the same public documented installation and configuration paths.
A private customer deployment repository is configuration and operations, not a
product fork. The first author's instance gets no special access or implementation
shortcuts. The deployment repository split is not an open architecture alternative.

The confirmed hosted target is a private repository deploying a pinned server release
to Vercel with Supabase database/auth settings, issuing an endpoint and per-app keys.
Applications install the documented SDK and initialize it from environment;
the operator uses Supabase sign-in for the private dashboard. See the exact
[hosted client/configuration contract](hosted-client-contract.md) for current versus
proposed variables, scopes, rotation and local/hosted separation.

## Ownership

The public product repository owns SDKs, server, UI, supported self-host images,
public configuration contracts, product schema migrations, compatibility guarantees,
release manifests, migration tooling and installation documentation. These are the
target product boundaries, not a claim that every artifact exists today. Keep actual
customer IDs, allowlists, domains, regions, platform project IDs and configuration
out of the product. Generic examples contain placeholders only.

A private customer repository consumes a pinned package or image through the
documented access path and owns the instance's Vercel/deployment configuration,
infrastructure setup,
secret-free environment templates, operator allowlist configuration, release pin,
upgrade approvals, provisioning and migration orchestration, backup/restore and
operations runbooks. Credentials remain in the customer's Vercel/Supabase secret
stores; the repo contains names/references, never values or exported .env files.
Configuring a deployment is not permission to access its application data.

The consuming application independently installs the documented SDK and retains all
inference. A deployment admin login, an app ingest credential and a provider key
are separate privileges. No model credential is needed just to ingest observations.

## Public customer interface

A valid installation must be reproducible by an unrelated customer using only:

1. A documented artifact available to authorized customers, pinned to an immutable
   version and integrity or image digest, plus published compatibility/release information.
2. Documented public configuration and supported auth/storage adapters.
3. Public installation, migration, verification, backup and upgrade instructions.

Do not use sibling source checkouts, repository-internal imports, private build
endpoints, unpublished patches, copied product server/UI source, hidden flags,
maintainer credentials or a customer-specific schema fork. An immutable public
package/image pin is acceptable; a repository commit alone is not an installable
server release. A private deployment must not compile a copy of upstream source as
an undocumented workaround for a missing release artifact.

The SDK uses the approved private GitHub Packages distribution path, with npm
later. Authorized customers use the same documented package-read permissions and
installation contract; private distribution does not justify maintainer-only source
access. Historical tarball tests are development evidence, not the current hosted
integration model. See [SETUP.md](SETUP.md) for the pinned consumer contract.

Server release publication and a public self-host image are separate deliverables.
The running author's instance does not prove that either is generally available.

## Schema migrations versus instance provisioning

There is one authoritative product schema and one migration history: upstream.

- Upstream owns product tables, indexes, functions, triggers, RLS/authorization
  policies and data transforms, including generic tenant/project semantics. Ship
  append-only migrations with each release, checksums/order, supported source
  versions, fresh-install and upgrade tests, and schema compatibility requirements.
  Preserve existing immutable versions, finalized datasets and backend secrets.
- The private repo provisions the approved database/environment and platform-level
  roles, secret bindings, network/auth integration and instance configuration. It
  selects the release and schedules the upstream migration runner. It does not
  copy, rewrite, reorder or reimplement upstream product migrations or customize
  product tables/policies. User/project/allowlist setup uses documented configuration
  or APIs, not ad hoc SQL against product tables.
- An upgrade checks the installed schema/release and migration checksums, obtains
  one migration lock, takes the approved backup, invokes the pinned upstream runner
  once, verifies the result, then rolls out compatible server/UI artifacts. Record
  the applied release/digests and migration result in the private repo's operations
  evidence without secrets or user content. Database permissions for migration are
  separated from normal application runtime permissions.
- Drift, unknown checksums or unsupported upgrade paths stop the rollout. Repair
  product schema with a new upstream migration; do not patch the private instance
  into a different schema line. Do not assume rolling back an image rolls back the
  database: use documented compatibility windows or an explicitly approved restore
  procedure. Retry/replay behavior must be tested on disposable populated databases.

Local development upgrades in lifespan; production only checks the explicitly migrated schema. The product provides `autoeval-migrate upgrade/status`, PostgreSQL locking,
entrypoint checksums and separate backend runtime grants. Follow [SETUP.md](SETUP.md).
The implementation validation used disposable test databases; instance migration
authorization and evidence belong to the operator.

## Vercel and self-hosting

The product may ship neutral Vercel examples and a generic self-host image. Instance
Vercel configuration belongs to the private repo and must consume supported public
artifacts. Vercel and a container image are distinct deployment targets: do not
assume Vercel directly runs an arbitrary self-host Docker image. The product provides a verified-bundle staging installer for Next.js/FastAPI;
see [server-release.md](server-release.md). Live installation acceptance and
immutable release publication remain separate from that implementation. Missing
installation capabilities belong upstream, not in a private source fork.

A supported public container on a compatible host is another customer path once
that image is released and verified. Other customers may choose other supported targets; that does not reopen the
confirmed Vercel decision for this instance. Provisioning still needs separate
operator approval. The current loopback Node/SQLite receipt service is a
local development option, not a serverless or public hosted receiver.

A link or authorized facade in a consuming application can lead to the customer's
AutoEval UI. It does not move product ownership into the application repo and must
use public APIs with server-enforced authorization. Shared login convenience does
not justify giving the app ingestion credential admin powers.

## Release and configuration ledger template

[instance-release.example.json](templates/instance-release.example.json) is a neutral
**design-only ledger**, not a loader, deployable manifest or supported configuration
schema. Its nulls/placeholders deliberately cannot identify an installable release.
It illustrates the provenance an eventual private deployment records: public artifact
pins, compatibility/migration manifest and non-secret configuration references.
Resolve its exact fields against the real upstream release contract before use.
Runtime environment templates must be generated from or checked against the chosen
release's documented configuration. This PR adds no new runtime environment names.

## Current implementation and remaining release gates

The PR26 onboarding gap list predates the PR28–29 implementation. It is replaced
here by the current division between implemented capabilities and release evidence:

| Area | Implemented in the product | Still a separate gate |
| --- | --- | --- |
| Application feed | FastAPI persistence, scoped keys, consent/retention, immutable manifests/experiments and `/applications` review | App-specific production consent and operational acceptance |
| Hosted auth | Supabase sign-in, server-wide authorization and operator allowlist | Instance enrollment, configuration and deployed isolation verification |
| Migrations | Explicit upgrade/status CLI, PostgreSQL locking, entrypoint checksums and runtime grants | Approved backup, upgrade and restore evidence per instance |
| SDK | Capture API and environment initializer, isolated packed-consumer tests | Exact-version distribution/access verification under the private registry contract |
| Server installation | Bundle/manifest verifier and Vercel staging installer | Published immutable assets and live customer-install acceptance |
| Self-host image | Documented product ownership and release boundary | A built, released and verified container image is not claimed |

The [server release contract](server-release.md) is the source for packaging and
publication gates; the [hosted client contract](hosted-client-contract.md) is the
source for implemented authentication, scopes and capture settings. The earlier
[issue #27](https://github.com/devalparikh/auto-eval/issues/27) records the original
gaps, not proof that implemented auth/feed/UI remain missing. New installation gaps
belong upstream with sanitized reproductions, never in private product patches.

This documentation cleanup does not publish artifacts, provision an instance,
change deployment settings or authorize production capture. Historical candidate
statements in release/contract documents describe their recorded validation scope;
they are not a live inventory of the author's deployment.
