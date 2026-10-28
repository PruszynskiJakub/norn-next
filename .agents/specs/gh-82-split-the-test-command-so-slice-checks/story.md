---
id: gh-82
slug: split-the-test-command-so-slice-checks
provider: gh
number: 82
url: https://github.com/PruszynskiJakub/norn-next/issues/82
title: Split the test command so slice checks run in seconds, not ~7 minutes
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: new
intake_at: 2026-10-28T15:24:57.025Z
body_hash: 7a2c3cf1a5897dba558c3ef71fcc8f08c32a3c7e2702c118f39dd4e498547bca
---

## Observed

Every `test` check step runs the full suite (`.agents/norn/workflows/slice.yaml:17`, `quick.yaml:36`, `story.yaml:66`, `fix.yaml:47`):
`bun install --frozen-lockfile && bun run test && bun run typecheck`, which takes ~7 min per run (gh-70's check receipt: `duration_ms: 424729`).
Two units at `test` in one tick make the tick take ~14 min, longer than a claim lives, so every claim expires and the cockpit shows everything as unclaimed (made worse by #77). The slice `test` step's `timeout: 10m` is within reach under load.

Measured on 2026-10-28 (one `bun test <path>` per row, while two checks and agents competed for CPU):

| part | time |
|---|---|
| full `bun test` | 387 s |
| packages/cli/test (29 files) | ~400 s if run file by file, ~90% of the suite |
| ↳ base-sync.test.ts | 71 s |
| ↳ human.test.ts | 48 s |
| ↳ prompts.test.ts | 31 s |
| ↳ auto-recovery, records, team, observe-snapshots, housekeeping | 19–22 s each |
| ↳ the other 19 files | ≤ 17 s each (e2e.test.ts: 14 s) |
| packages/adapters/test | 26 s |
| packages/store/test | 10 s |
| packages/view, core, schema | ~4 s together |
| `bun run typecheck` | 6 s |

There is no real e2e tier: e2e.test.ts is 14 s. The cost is the cli package's integration tests.

## Wanted

- Scripts in `package.json`:
  - `test:fast`: everything except `packages/cli/test` (~40 s)
  - `test:cli`: the cli tests
  - `test`: both (unchanged meaning)
- Slice `test` checks run `test:fast` + `typecheck` (plus the cli test files the slice touches, if that can be selected simply); the story-level `test` step and CI keep the full suite.
- Drop `bun install --frozen-lockfile` from the check when it is not needed, or keep it only where the lockfile can change.
- Look at why `base-sync` (71 s) and `human` (48 s) are slow (real git and process spawns?) and make them cheaper without losing what they pin.
- Update AGENTS.md's Commands section with the new scripts.

## Where

- `package.json` scripts (`"test": "bun test"`)
- `.agents/norn/workflows/{slice,quick,story,fix}.yaml` `test.run`
- `.github/workflows/ci.yml:32`
- `packages/cli/test/base-sync.test.ts`, `packages/cli/test/human.test.ts`

## PRD

None directly; related: K1 (`max_checks`), C5 (check receipts). See #77, #78.
