# Reviewing a norn change

Short on purpose. The contributor guide is `AGENTS.md`.

## Skip

Generated or recorded, rewritten by a command, never by hand:

- `packages/schema/json/` (`bun run schema:emit`)
- `packages/core/test/golden/` (`bun run golden`)
- `test/e2e/transcripts/` and `test/e2e/observe-snapshots/` (`NORN_TRANSCRIPT_UPDATE=1`)
- `runs/` (run state; it belongs in the machine dir, never in the repo)

Judge the change that made them move, not the files.

## What counts as a failure

- **A persisted format that breaks old records.** A schema in `packages/schema/src/` changed so that a `state.json`, receipt, trace, claim or config an older norn wrote no longer validates or reads the same.
- **A claim or lease race.** Two ticks or two checkouts can both believe they own a story, a slot or a lease (lease files are created with `O_EXCL`).
- **A write that is not atomic.** A file norn writes outside store's temp file, fsync and rename; a receipt written after its effect; `state.json` not written last.
- **Core reaching for IO.** `fs`, `Bun.spawn`, `Date.now()` or a random id in `@norn/core`, instead of facts and `deriveUlid`.

## How to write a finding

- No style nits: the type check and the repo lints in the unit tier own style.
- Every finding cites a file and a line (`path/to/file.ts:42`) and says what goes wrong.
