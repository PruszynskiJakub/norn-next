---
id: gh-88
slug: a-story-merged-while-parked-at-the-ready
provider: gh
number: 88
url: https://github.com/PruszynskiJakub/norn-next/issues/88
title: A story merged while parked at the ready gate stays in the inbox as waiting for approval
assignee: PruszynskiJakub
labels:
  - friction
  - norn
workflow: triage
status: new
intake_at: 2026-10-28T21:28:53.196Z
body_hash: 376114637a652f80c426d9d4f2012abd148872c753987431ffa7aaccdba21eee
---

## Observed

gh-60, gh-69 and gh-76 had their PRs merged (#84, #81, #83) while each story was parked at the `ready` gate, before anyone ran `norn approve`. GR6 cleanup ran ("norn: gh-N done (PR merged)" is on main, the worktrees are gone, and `story.md` says `status: done`). `norn inbox` still lists all three under **Approve** with `$ norn approve gh-N`, and `norn status` shows `parked ready#1 (gate: …)`.

On `origin/main`, each story's `runs/_story/state.json` still says `{status: parked, step: ready, park: {kind: gate}}`. The squash merge committed the parked state, and the cleanup rewrites only `story.md`.

gh-69 and gh-76 also still have claim refs (`refs/norn/claims/gh-69`, `gh-76`, local and on origin). They were taken again after the cleanup: gh-69's cleanup commit is at 15:25Z and its claim `acquired_at` is 15:31Z. So every tick renews those claims and decides `unit.parked.gate` for a story that is done. gh-60 has no claim and decides `story.finished`, but the view still shows its gate.

## Wanted

Once a story's PR is merged and recorded done, the story disappears from the inbox's Approve, Your turn and Running lists, and `norn status` shows it as done. A merged PR is the final outcome. A gate still open at merge time is moot and needs nothing from the person. No claim is held or renewed for a story that main records as done.

## Repro

In a throwaway repo, take a story to the `ready` gate and merge its PR without running `norn approve`. Let a tick run the GR6 cleanup. `norn inbox` still lists the story under Approve.

## Where

- `packages/cli/src/runtime/act/lifecycle.ts:213` `cleanupMerged`: writes the `story.md` status through `record`, but never touches the unit's `state.json`.
- `packages/core/src/decide/story.ts:53` `decideStory`: when this heartbeat holds the claim, `storyLifecycle` returns early on `fm.status === "done"` and `decideUnit` then decides `unit.parked.gate`. Something decided to take the claim again after the cleanup (`story.ts:62-71`).
- `packages/core/src/inbox/items.ts`: builds the Approve item from a parked gate without checking `story.md` / `base_status: done`.

## PRD

GR6 (a merged story is done, and its claim and mailbox refs are deleted), R3.2 (the base record wins and a done story is never acquired), §12's default workflow note (after `$done` the story waits for the PR merge, "a fact, not a gate").
