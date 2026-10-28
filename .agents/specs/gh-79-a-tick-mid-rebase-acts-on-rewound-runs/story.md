---
id: gh-79
slug: a-tick-mid-rebase-acts-on-rewound-runs
provider: gh
number: 79
url: https://github.com/PruszynskiJakub/norn-next/issues/79
title: A tick mid-rebase acts on rewound runs/ files and leaves a stray receipt that corrupts the unit
assignee: PruszynskiJakub
labels:
  - friction
  - norn
workflow: triage
status: active
intake_at: 2026-10-28T13:34:51.169Z
body_hash: 8a4911a4427a6eed5d18b06f6cac6e4807638ca819b101e10affede2b7bd2adb
---

## Observed

gh-75/01, `slice` workflow, trace `.agents/norn/trace/2026-10-28.jsonl` (UTC):

- 11:04:43 `git.integrate` → `conflict`; 11:05:13 integrate → merge (`conflict_loop` 2/2); 11:05:43 merge run `01M612ZWXYFC3TKZCYPPNY7QN2` started.
- Between 11:06:13 and 11:06:43 the merge agent ran `git rebase <story branch>` by hand in the slice worktree (integrate only rebases, so a merge commit cannot satisfy it — see #80). The rebase stopped on conflicts with HEAD detached on the story tip, so the working tree's `runs/01-…/` was rewound to the slice's state from 09:34: step `implement`, `applied_through` 1.
- 11:06:43: the facts had `worktree.in_progress = {operation: "rebase", unmerged: [4 files]}` and `state.step = "implement"`. decide treated the rewound files as the live unit; the `implement` deadline had passed, so `agent.timeout.surface` emitted `classify`. act wrote `receipts/0002-classify.json`, `state.json` and `handoff.md` into the working tree and deferred only the commit ("rebase in progress … the commit waits until it is concluded").
- Between 11:07:13 and 11:07:43 the agent aborted the rebase. Tracked files went back to HEAD (step `merge`, `applied_through` 23); the untracked `0002-classify.json` stayed next to the committed `0002-done.json`.
- 11:07:43 `unit.corrupt`: "duplicate receipt number 2 (also 0002-classify.json)" on `receipts/0002-done.json`, `state.json` set to `corrupt`. 11:08:13 the story went to `$stuck` (`slices.slice_stuck`).
- 232 ticks of `unit.corrupt` noop followed (S2). The merge agent kept running and was never nudged. Around 13:05 the stray file was gone and `state.json` back to `running` (no trace event says who); then `recover.commit`, `slices.resume`, and a timeout nudge for merge.
- What the person saw: two Unblock items. "corrupt: …/0002-done.json failed validation (S2)" names the committed, valid receipt, not the stray one, and suggests no fix. "slices.stuck → $stuck" says `norn unstick gh-75/01`, but `unstick` refuses a corrupt unit (`packages/cli/src/commands/unstick.ts:24`, `packages/cli/src/runtime/human.ts:170,173`).

## Wanted

While a git operation that rewrites the working tree is in progress in a unit's worktree (a rebase in particular: HEAD detached, `runs/` rewound), norn does not act on that unit's `runs/` files: no receipt, no `state.json`, no deadline classified against the rewound state. It reports a distinct fact ("rebase in progress in <worktree>") and holds the unit. A receipt norn wrote but never committed can never collide with a committed one. If a collision happens anyway, the inbox item names the stray file and says how to recover, and the stuck hint does not point at a command that refuses.

## Repro

Reconstructed from the trace and git history, not run:
1. Get a slice to `merge` after `integrate` returns `conflict`, with its earlier step's deadline (`implement`, 60m) long past.
2. In the slice worktree run `git rebase <story branch>` and let it stop on conflicts.
3. Wait one tick: `agent.timeout.surface` for the old step; an untracked `receipts/000N-classify.json` and a modified `state.json` appear, commit deferred.
4. `git rebase --abort`. On the next tick the unit is `corrupt` ("duplicate receipt number N") and stays so until the stray receipt is deleted and `state.json` restored by hand.

## Where

- `packages/adapters/src/git/index.ts:188-212` reports `in_progress`; commit guard `:343-350`; act defers at `packages/cli/src/runtime/act/env.ts:164`; fact `packages/core/src/facts.ts:52-56`.
- decide uses `in_progress` only to skip the recovery commit (`gitBusy`, `packages/core/src/decide/receipts.ts:95-96`, used at `packages/core/src/decide/story.ts:279-285`). Timeouts (`packages/core/src/decide/agent.ts:235-242`), receipts apply and the rest still run on the working-tree `runs/`.
- Receipts and state read from the worktree: `packages/store/src/local-facts.ts:130-148`. Duplicate number rejected: `packages/store/src/receipts.ts:43-47`.
- Corrupt marked, then never touched: `packages/core/src/decide/story.ts:247-255,262`. Inbox item: `packages/core/src/inbox/items.ts:471-473`. Stuck hint `norn unstick`: `packages/core/src/decide/steps.ts:199-207`.

## PRD

- S2: correct in itself, but the corrupt file was norn's own write. S1, S3, S5: receipt and `state.json` written against a rewound state. H1.
- BS5.1 (`.agents/SPEC-base-sync-and-qa.md:78`): other rules, `timeout` included, run as usual while an operation is in progress — written for an agent's merge, where `runs/` is not rewound.
- GR4, BS4/BS5: the agent rebased by hand, pushed to it by integrate's rebase (W2, K6).
