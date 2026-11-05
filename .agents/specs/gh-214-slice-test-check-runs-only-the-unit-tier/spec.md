---
id: gh-214
slug: slice-test-check-runs-only-the-unit-tier
provider: gh
number: 214
url: https://github.com/PruszynskiJakub/norn-next/issues/214
title: Slice test check runs only the unit tier and the type check
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: done
intake_at: 2026-11-05T16:40:30.386Z
body_hash: c7a35d11b63f92cdbeee24990fc1de6bc44ba6ff5b0c7af044d86f13066bfdfc
merge:
  pr: 219
  url: https://github.com/PruszynskiJakub/norn-next/pull/219
  head_sha: b389b2a88e1ac34d1b7552a8811a9c9c9545e157
  merge_commit_sha: 6eabb4636f7ab8d3b58e2548c13039f4979b1fe8
  merged_by: PruszynskiJakub
  merged_at: 2026-11-05T17:25:31.000Z
---

## Observed

The slice workflow's `test` check runs every tier but e2e:
`bun install --frozen-lockfile && bun run test && bun run test:integration && bun run typecheck` (timeout 15m).
The story workflow's `test` check runs the same command again once the slices are integrated, and CI
runs every tier a third time.

On gh-195 (18 slices, up to 4 slice checks at once) each slice check took 2–6 min (360s on slice 17
under load), and every implement → test → review round paid it. All of its slice-level integration
failures came from load, not from a bug in the slice:
- 06 test#2 hit the 900s check timeout (an integration file hung under parallel load), and implement#3
  spent 53 min finding out it was a flake.
- 09 test#1 and 15 test#1 failed on another slice's slow property test (record-ref `pack (D2) > F1`,
  20s per-test timeout), and each slice had to work around it.

## Wanted

The slice `test` check runs `bun install --frozen-lockfile && bun run test && bun run typecheck`.
The integration tier stays in the story's `test` check (after every slice is integrated, before qa) and
in CI. Slice loops get shorter, and several slices running at once put less load on the machine.
The slice implement step's instructions say where the integration tier now runs.

Tradeoff: an integration break shows up at the story's `test` check, after the slices are integrated,
and the fix goes to the story's implement step, not the slice that caused it.

## Where

- `.agents/workflows/slice.yaml:11` (implement instructions), `.agents/workflows/slice.yaml:15` (`test.run`)
- `.agents/workflows/story.yaml:57-61` (the story `test` check that keeps the integration tier)
- `packages/cli/assets/workflows/slice.yaml`: shipped copy; decide whether it changes too (AGENTS.md: change a shipped workflow in both places)
- `AGENTS.md` Commands: "a workflow's `test` check runs the unit tier, the integration tier and the type check"; say the slice check does not

## Rules

W1 (repo-local workflows; shipped copies are examples).
