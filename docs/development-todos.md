# Product follow-ups

- [ ] Revisit application-capture retention for storage optimization and privacy.
  Capture v2 defaults both metadata and diagnostic content retention to **Keep**
  (`null`), per the approved integration decision. Operators can select a finite
  period; withdrawal and explicit deletion still erase evidence. Review storage
  growth, physical purge scheduling, backups and consent before proposing a new
  default. Do not introduce an implicit TTL while this item is open.
