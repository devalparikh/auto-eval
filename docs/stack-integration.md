# Draft stack and runner reconciliation

Review/apply order: PR26 imported package/feed → PR28 server artifact contract →
PR29 hosted auth/feed/migrations → this PR24 runner reconciliation layer.

This layer carries PR24's exact generic trusted-local-runner source/test changes
and documentation patches onto PR29. Its original branch/head are untouched.
The non-generated patches apply cleanly. OpenAPI and TypeScript API types were
regenerated from the combined runtime; do not resolve them by choosing one side.
It adds no Lifty-specific runtime, no server-executed adapter and no provider
privilege to hosted app keys. The local runner remains explicitly trusted and
loopback-only, not an OS sandbox or a hosted execution service.

For eventual merge, choose one route through the coordinator: merge original PR24
and regenerate combined types when integrating this stack, or use this reconciled
layer as the implementation of those changes. Do not apply the same delta twice.
No existing PR is merged, rewritten, force-pushed or closed by this layer. PR25's
supersession/closure remains a coordinator decision after the independent review.

Review PR24 original behavior and the combined host boundary, particularly immutable
harness request hashing/idempotency and generated schema union. The upstream hosted
stack's auth/migration/consent review surfaces remain mandatory.

The combined dashboard also freezes comparison selections during an outstanding
comparison request and clears comparison results on refresh, so a late response
cannot be presented under a different selected experiment pair.
