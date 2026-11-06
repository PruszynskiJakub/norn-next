---
id: gh-88
slug: a-merged-story-pr-ends-the-story-cleanly
provider: gh
number: 88
url: https://github.com/PruszynskiJakub/norn-next/issues/88
title: A merged story PR ends the story cleanly, and a workflow may merge it itself
assignee: PruszynskiJakub
labels:
  - friction
  - norn
  - norn:kind:bug
  - norn:priority:medium
  - norn:risk:high
  - norn:wf:quick
workflow: quick
status: done
intake_at: 2026-11-06T09:17:02.313Z
body_hash: 565a361dac0ebcbdb2fc9e09c66aaf9f5be964be8d80a4d00b3e32c6523d5da8
merge:
  pr: 257
  url: https://github.com/PruszynskiJakub/norn-next/pull/257
  head_sha: fec2ae443546f233a80a2f903be5705f096ce59a
  merge_commit_sha: 98bac119ef612c198acb4a3b1218bc36659a511c
  merged_by: PruszynskiJakub
  merged_at: 2026-11-06T14:28:17.000Z
---

One change about the end of a story: once its PR is merged, GR6 cleanup records the story done (state.json, claim, inbox), even when it was parked at a gate (#88), and a workflow may merge its own PR behind a gate a person approves, with cleanup running the same way (#72). Fix #88's cleanup first; #72 builds on it.

Folds in: #72. Each one's original text is kept below, under its own heading.

---

# From #88: A story merged while parked at the ready gate stays in the inbox as waiting for approval

### Observed

gh-60, gh-69 and gh-76 had their PRs merged (#84, #81, #83) while each story was parked at the `ready` gate, before anyone ran `norn approve`. GR6 cleanup ran ("norn: gh-N done (PR merged)" is on main, the worktrees are gone, and `story.md` says `status: done`). `norn inbox` still lists all three under **Approve** with `$ norn approve gh-N`, and `norn status` shows `parked ready#1 (gate: …)`.

On `origin/main`, each story's `runs/_story/state.json` still says `{status: parked, step: ready, park: {kind: gate}}`. The squash merge committed the parked state, and the cleanup rewrites only `story.md`.

gh-69 and gh-76 also still have claim refs (`refs/norn/claims/gh-69`, `gh-76`, local and on origin). They were taken again after the cleanup: gh-69's cleanup commit is at 15:25Z and its claim `acquired_at` is 15:31Z. So every tick renews those claims and decides `unit.parked.gate` for a story that is done. gh-60 has no claim and decides `story.finished`, but the view still shows its gate.

### Wanted

Once a story's PR is merged and recorded done, the story disappears from the inbox's Approve, Your turn and Running lists, and `norn status` shows it as done. A merged PR is the final outcome. A gate still open at merge time is moot and needs nothing from the person. No claim is held or renewed for a story that main records as done.

### Repro

In a throwaway repo, take a story to the `ready` gate and merge its PR without running `norn approve`. Let a tick run the GR6 cleanup. `norn inbox` still lists the story under Approve.

### Where

- `packages/cli/src/runtime/act/lifecycle.ts:213` `cleanupMerged`: writes the `story.md` status through `record`, but never touches the unit's `state.json`.
- `packages/core/src/decide/story.ts:53` `decideStory`: when this heartbeat holds the claim, `storyLifecycle` returns early on `fm.status === "done"` and `decideUnit` then decides `unit.parked.gate`. Something decided to take the claim again after the cleanup (`story.ts:62-71`).
- `packages/core/src/inbox/items.ts`: builds the Approve item from a parked gate without checking `story.md` / `base_status: done`.

### PRD

GR6 (a merged story is done, and its claim and mailbox refs are deleted), R3.2 (the base record wins and a done story is never acquired), §12's default workflow note (after `$done` the story waits for the PR merge, "a fact, not a gate").


---

# From #72: A workflow can merge its own story PR

### Observed

GR5 says a person merges the story PR, and every workflow here ends at a `ready` gate where a person
merges by hand. Came up while designing the runs model in #71: once a story is a sequence of runs
and only a merge ends it, a workflow could end with the merge itself, behind a gate a person
approves, instead of the person switching to GitHub to click merge.

### Wanted

Decide whether a workflow may merge its story PR, e.g. a `git: merge` action placed after a gate,
and under what rules. To settle:
- GR5 ("a person merges the story PR") and the AGENTS.md process ("a person merges the PR"): does a
  person approving a gate right before the merge count?
- Merge method (squash only here) and the commit message (PR title and body).
- The CI process check, and branch protection / required checks: what to do when the merge is refused.
- GR6 and BS11: a merge norn made must look like any other merge, so cleanup runs the same way.

Parked from #71; the runs model does not depend on it.

### PRD

GR5, GR6, BS11, W2 (`git` actions), W8 (`git` actions only on a story).

