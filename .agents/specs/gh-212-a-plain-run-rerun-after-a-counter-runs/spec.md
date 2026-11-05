---
id: gh-212
slug: a-plain-run-rerun-after-a-counter-runs
provider: gh
number: 212
url: https://github.com/PruszynskiJakub/norn-next/issues/212
title: A plain run rerun after a counter runs out restarts the same step on unchanged code
assignee: PruszynskiJakub
labels:
  - friction
  - norn
  - norn:kind:feature
  - norn:priority:medium
  - norn:risk:medium
  - norn:wf:quick
workflow: quick
status: new
intake_at: 2026-11-05T23:06:55.379Z
body_hash: 64351b8cd4a4dd5a85e6b14adfbd60995638b4341b3a8b18e31d9226de243bbc
---

## Observed

In gh-196's quick round, `review_loop` (max 3) ran out at review#4 (`changes_requested`), which sent the unit to `$stuck`. `norn run rerun gh-196` (receipts 0033 and 0037) restarted `review`. Reviews #5 and #6 ran on unchanged code ("code unchanged since review#4 (only runs/ differ)"), reached the same blocking finding and went stuck again. Only `norn run rerun gh-196 --step implement --reset review_loop` (receipt 0041) moved the story on. That cost two full review sessions and about 6 minutes.

## Wanted

When a unit is stuck because a counter ran out on an outcome, the way out that norn suggests leads to that outcome's target with the counter reset (here `--step implement --reset review_loop`). A plain rerun of the same step, with no change since that step last ran, at least warns that it will most likely end the same way.

## Repro

In a throwaway repo, use a workflow whose review sends `changes_requested` back to implement with `review_loop: { max: 1 }`. Get two `changes_requested` outcomes so the unit goes stuck, run `norn run rerun <unit>`, and see review run again on the same commit.

## Where

- `packages/core/src/decide/agent.ts:298`: a counter that runs out routes the unit to `$stuck`
- `packages/cli/src/commands/run-rerun.ts:59`: without `--step`, rerun resumes at the stuck step

## Rules

W4 (counters), W7, B48, B49
