# Product and customer deployment contract

**Decision:** AutoEval is the generic product. Every operator, including its author,
consumes it through the same public documented installation and configuration paths.
A private customer deployment repository is configuration and operations, not a
product fork. The first author's instance gets no special access or implementation
shortcuts. The deployment repository split is not an open architecture alternative.

The confirmed hosted target is a private repository deploying a pinned public release
to Vercel with Supabase database/auth settings, issuing an endpoint and per-app keys.
Applications install the public registry SDK and initialize it from environment;
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

A private customer repository consumes a pinned, publicly obtainable package or
image and owns the instance's Vercel/deployment configuration, infrastructure setup,
secret-free environment templates, operator allowlist configuration, release pin,
upgrade approvals, provisioning and migration orchestration, backup/restore and
operations runbooks. Credentials remain in the customer's Vercel/Supabase secret
stores; the repo contains names/references, never values or exported .env files.
Configuring a deployment is not permission to access its application data.

The consuming application independently installs the public SDK and retains all
inference. A deployment admin login, an app ingest credential and a provider key
are separate privileges. No model credential is needed just to ingest observations.

## Public customer interface

A valid installation must be reproducible by an unrelated customer using only:

1. A documented public artifact, pinned to an immutable version and integrity or
   image digest, plus published compatibility/release information.
2. Documented public configuration and supported auth/storage adapters.
3. Public installation, migration, verification, backup and upgrade instructions.

Do not use sibling source checkouts, repository-internal imports, private build
endpoints, unpublished patches, copied product server/UI source, hidden flags,
maintainer credentials or a customer-specific schema fork. An immutable public
package/image pin is acceptable; a repository commit alone is not an installable
server release. A private deployment must not compile a copy of upstream source as
an undocumented workaround for a missing release artifact.

The current local tarball in Lifty is explicitly a **pre-release development test**
of the package contract. It is not a published customer installation or permission
to use a maintainer-only distribution path for the private instance. Product
release/publication needs separate approval. A public self-host image must be built,
verified and documented upstream before an instance can pin it.

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

The current FastAPI app creates/upgrades schema in its lifespan. A separate,
publicly documented release migration command, locking/checksum behavior and a
Vercel-safe migration orchestration path have **not** been implemented by this PR.
The private repo must not invent commands or run copied SQL to bridge that gap.
Any approved migration-runner lifecycle change belongs upstream and needs fresh/
upgrade/repeated-run testing before deployment. No migration is executed here.

## Vercel and self-hosting

The product may ship neutral Vercel examples and a generic self-host image. Instance
Vercel configuration belongs to the private repo and must consume supported public
artifacts. Vercel and a container image are distinct deployment targets: do not
assume Vercel directly runs an arbitrary self-host Docker image. Before enabling the confirmed
Vercel target, upstream must document and verify how its released Next.js/FastAPI artifacts
are installed and routed there without copying source. If that adapter is missing,
record a product gap; do not fall back to a maintainer's source-linked Vercel project.

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

## Customer onboarding gaps tracked by this change

The following are upstream product work, not private-repo implementation tasks:

- Approve a license/namespace and release the public SDK with documented integrity
  and supported runtime matrix. The local artifact remains private/unpublished.
- Package/release server and UI for customer installation; build and test the public
  self-host image. No image or container build is present in this PR.
- Implement and test the hosted feed/storage integration and generic scoped auth;
  expose supported configuration for provider/issuer and operator allowlists.
  The existing Basic-auth preview does not implement the proposed customer auth.
- Provide the public migration/upgrade tooling and supported Vercel install adapter
  described above, with fresh-install and upgrade smoke checks using only public
  artifacts/configuration. Vercel deployment from upstream source is existing
  behavior, not evidence that this new customer installation contract works.
- Integrate observation review into the product UI and document consent, deletion,
  backup lifecycle and inference permissions end to end.

These gaps are filed upstream in [issue #27](https://github.com/devalparikh/auto-eval/issues/27);
none is claimed resolved by this docs update. When setup exposes an
additional gap, fix it upstream or file an upstream issue with a sanitized repro,
expected public behavior and acceptance check. Never paper over it in the private
repo. Public release, instance creation and production enablement remain separately
authorized actions. No customer repository, release, image or deployment was created.
