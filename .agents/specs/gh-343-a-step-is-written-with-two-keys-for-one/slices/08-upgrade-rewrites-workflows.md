---
id: gh-343/08
title: norn upgrade rewrites old-wording workflow files
depends_on: [gh-343/03, gh-343/04]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
---

## Goal
A person runs `norn upgrade` once and every old-wording file in the main checkout's `.agents/workflows/` and `shared/` is rewritten to the new wording and staged with the rest of the upgrade; a file that cannot be rewritten is listed with its line, the rest still move.

## Scope
User stories: rewrite and stage workflow and shared files; an unplaceable comment refusing that file only, the others rewritten; a second run changing nothing; run state untouched; an all-new repo reporting no workflow change. Seams: S6. Out: the translation itself (slice 03); refusing old files elsewhere (slice 09).

## Acceptance
- AC1 Given a repo whose `.agents/workflows/` and `shared/` hold old-wording files, when `norn upgrade` runs, then each is rewritten to the new wording (loading to the same workflow), staged with the rest of the upgrade, and listed under the report's `workflows.rewritten`, in `--json` and in markdown. — verifier: test
- AC2 Given one file holding a comment the rewrite cannot place, when `norn upgrade` runs, then that file is left as it was and listed under `workflows.refused` with its file, line and message, every other file is rewritten, `norn_version` is still written, and the exit code is 0. — verifier: test
- AC3 Given `norn upgrade` already ran, when it runs again, then no workflow file changes. — verifier: test
- AC4 Given a repo whose files are all in the new wording, when `norn upgrade` runs, then it rewrites none and reports no workflow change. — verifier: test
- AC5 Given units with pins, receipts and state in the machine dir, when `norn upgrade` runs, then a hash of the machine dir's run state is the same before and after. — verifier: test

## Checks
- `bun run docs:emit`
- `bun run test`
- `bun run typecheck`

## Notes
D9. The rewrite runs after upgrade's other checks pass and before `norn_version` is written. The upgrade tests are in the integration tier, which runs in CI.
