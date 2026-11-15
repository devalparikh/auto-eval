# SDK publishing

`@devalparikh/autoeval` targets `https://npm.pkg.github.com` with restricted access,
the `private` dist-tag and an UNLICENSED license. It has no runtime dependencies.
This process publishes only the SDK, never the server bundle or an instance.

## Approval and triggers

Only merge a publishing change when Deval explicitly asks. Merging is the go-ahead
to publish: `Publish SDK` runs on pushes to `main` that change
`packages/trace-feed/**`. A version bump in an approved merged PR signals a new
publication. Other branch pushes and PR events cannot publish. PR CI tests the
helper without registry credentials or publication.

The workflow checks out the immutable event `github.sha`, not the moving `main`
branch. A normal merge commit runs against that merge commit's source. This PR
changes the package README and repository metadata, so its merge matches the path
filter. Main after the capture stack was
`efe3e35f95f8f9a963ef74afd6c6438cf2db8d8a`, with version `0.2.0-private.1`.
That version has **not been published manually**. The last authorized registry
read found only `0.1.0-private.1` (`private` pointed to it). If the target remains
absent and Actions has package access, merging this workflow PR will immediately
attempt to publish `0.2.0-private.1` from the new merge commit.

Fallback: explicitly approved `workflow_dispatch` of `Publish SDK` on `main`
retries the version at the event's pinned commit. There is no local/PAT publishing
fallback, and no dispatch was performed while preparing this change. Workflow-only
or helper-only changes do not match the package path filter; use the manual Actions
fallback if such a change needs to retry a failed publication.

## Versions and immutable registry entries

Use `0.2.0-private.N` for successive capture-v2 prereleases, increasing `N` whenever
published package bytes must change, including published documentation or metadata.
Use a new minor for added SDK API behavior and a new patch for compatible fixes
when starting the next prerelease line (for example `0.3.0-private.1` or
`0.2.1-private.1`). Breaking pre-1.0 API changes require an explicitly reviewed new
minor. The helper accepts `0.MINOR.PATCH-private.N`, with positive `N`; stable or
1.x releases need a separate reviewed policy change.

An existing version skips successfully; it is never overwritten, unpublished,
retagged or claimed to match the current source. Changes without a version bump
therefore do not update a published version. `private` is a distribution channel,
not an access-control setting, and `latest` is never moved by this workflow.

Only authenticated HTTP 404 or a valid metadata response lacking the exact version
means absence. Unauthorized/forbidden responses, server errors, transport failures,
redirects and malformed metadata fail the run. Do not interpret a failed lookup as
permission to publish.

## Credentials, access and visibility

The only publishing credential is the repository's built-in, per-job
`secrets.GITHUB_TOKEN`, passed as `NODE_AUTH_TOKEN` to the publishing step.
`packages: write` is granted only to the publish job, alongside `contents: read`.
No PAT, T3 secret file, local Mac credential or new stored secret is used.
Checkout does not persist Git credentials. A temporary npm config contains only an
environment-variable reference and is removed with its temporary cache on success
or error. Npm subprocess output is suppressed; tokens/config contents are never
logged or uploaded.

For the existing package, its owner must ensure **Manage Actions access** grants
`devalparikh/auto-eval` write access, or that the package is connected to this repo
and inherits the appropriate permissions. The SDK `repository` metadata identifies
that association; adding metadata alone does not grant access to an existing
package. Repository/organization policies must also permit the requested token
permissions. An access failure stops publication; the workflow does not modify
package permissions or fall back to another credential.

`--access=restricted` requests restricted publication. GitHub controls actual
package visibility and granular access in package settings; neither a dist-tag nor
successful authenticated download proves private visibility. Before approving the
merge, the owner must confirm the existing package remains private with intended
repository/team access. This change does not change those settings or claim to have
audited them. See GitHub's [npm registry authentication guide](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry),
[Actions access controls](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)
and [GITHUB_TOKEN publishing guide](https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages).

## Build, publish and verification

The job runs publisher unit tests and `npm run test:package` (build, offline packed
consumer and SDK tests) before exposing the token to the helper. Then
`python3 scripts/sdk_publish.py` checks the source SHA and clean tracked files,
looks up the version, and packs with lifecycle scripts disabled. It validates the
package name/version/license/dependency/publication settings, an exact file
inventory and byte-for-byte equality against package.json, README and source files
copied into dist. Unknown files, links, duplicates, missing files or modified bytes
fail. Adding a shipped file requires updating the reviewed inventory guard.

The helper computes SHA-1 `shasum` and SHA-512 SRI `integrity` for the exact tarball,
rechecks source and version absence, then runs:

```sh
npm publish <validated-tarball> --ignore-scripts \
  --registry=https://npm.pkg.github.com --access=restricted --tag=private
```

Push and manual runs share one non-cancelling concurrency group. The final version
check handles a version published during preparation. External publishers are not
covered by that lock; a registry collision fails safely and never replaces bytes.
Actions can coalesce pending concurrency runs, so this is not a promise to publish
every intermediate push. Retry a missed version only through a separately reviewed
change on main; the fallback does not select an arbitrary old source/ref.

After publishing, the helper requires matching registry name/version,
`dist-tags.private`, `dist.shasum` and `dist.integrity`. Failure after a successful
upload requires inspection of that immutable version; a rerun will skip it rather
than republish or silently repair a tag. The run summary and 90-day
`sdk-publication-<source SHA>` artifact record status, source commit, run URL,
version, registry, tag and computed hashes. Preserve that JSON in the consuming
release/lock review for longer-lived evidence. A skipped run records the skip and
source but makes no provenance claim about the already-existing version.

Consumers pin the exact version and integrity in a committed lockfile and use
authenticated `npm ci` as described in the SDK README. This workflow's installed
consumer test uses packed local bytes; registry metadata verification does not
claim a clean authenticated registry install or an access-control audit.

## Provenance limits

Do not add `--provenance` or `id-token: write` here. npm's
[provenance prerequisites](https://docs.npmjs.com/generating-provenance-statements/#prerequisites)
describe the npm registry and a public source repository; its
[trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/)
also excludes provenance generation for private repositories. That is not a
supported provenance route for this private GitHub Packages publication.
The source/checksum record is auditable Actions evidence, **not** a signed npm
provenance attestation. No OIDC credential or transparency-log claim is made.
