## Release 0.12.1

**Version:** 0.12.1, from the issue's `## Version`. It is a patch: the one change since v0.12.0 (#112) changes only how receipts and `state.json` are formatted on disk. Schemas and readers stay the same, and older files still read.

## Changelog

### Changed

- Receipts (`NNNN-<kind>.json`) and `state.json` under `runs/` are written as one line of JSON plus a newline instead of pretty-printed, so norn's own files no longer make up most of every PR's diff. Writes stay atomic (S1) and `state.json` is still written last (S5). Older pretty-printed files still read and validate, and nothing is migrated. Machine-local files under `~/.norn` (leases, trace, heartbeat, caches) keep their format.
