# Product follow-ups

- [x] Replace the pending manual SDK publication plan with the reviewed
  [Actions publishing process](sdk-publishing.md). Built-in GITHUB_TOKEN only;
  workflow_dispatch is the manual fallback. No local publication occurred.

- [ ] Revisit application-capture retention for storage optimization and privacy.
  Capture v2 defaults both metadata and diagnostic content retention to **Keep**
  (`null`), per the approved integration decision. Operators can select a finite
  period; withdrawal and explicit deletion still erase evidence. Review storage
  growth, physical purge scheduling, backups and consent before proposing a new
  default. Do not introduce an implicit TTL while this item is open.
