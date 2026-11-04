---
id: gh-195/15
title: A finished story's record is archived on its ref, never on the base
depends_on: [gh-195/03, gh-195/07]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
---

## Goal
When a story's PR merges (GR6) or it closes without a PR (GR6b), its final record is pushed to its ref before any cleanup, and the base branch gains no run state; `run list`, `run view` and `story reopen` read the record from the ref on any machine, fetched on demand, and `tidy` never touches the refs.

## Scope
Behaviour: B29, B30 (fresh clones), B31, B32. Seams: S1. Out: moving the base's existing run state (gh-195/16).

## Acceptance
- AC1 (B29) Given gh-9's PR merges, when the holder's tick runs GR6, then `refs/norn/runs/gh-9` holds the final record before the cleanup, the base branch gains no run-state file, and a rejected archive push leaves the cleanup owed and retried at the next tick. — verifier: test
- AC2 (B29, B30) Given a fresh `git clone` of the remote after AC1, when the clone is listed, then it has no `refs/norn/runs/*`; when `norn run list gh-9` and `norn run view <run>` run on it, then they fetch `refs/norn/runs/gh-9` alone and list every round and step. — verifier: test
- AC3 (B29) Given gh-9 closed without a PR (GR6b), when the tick closes it, then its final record is on the ref and the base gains no run-state file. — verifier: test
- AC4 (B31) Given archive refs on the remote and locally, when `norn tidy` runs, then it neither lists nor deletes any `refs/norn/runs/*` ref. — verifier: test
- AC5 (B32) Given gh-9 closed by GR6b and its issue reopened, when `norn story reopen gh-9` runs on any clone, then it unpacks the record from the ref and gh-9 is at its last round's `$done`, ready for a new round. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run test:integration`

## Notes
D7 (finished stories' run state from the archive ref, not the base tree), D15. Today GR6 writes the record onto the base (the base record, `records` and `housekeeping` tests); that path goes away here. Readers of a finished story whose run state is still on the base tree from an older norn keep working until gh-195/16 moves it.
