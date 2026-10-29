---
id: gh-101
slug: the-merge-skill-lets-an-agent-rebase-a
provider: gh
number: 101
url: https://github.com/PruszynskiJakub/norn-next/issues/101
title: The merge skill lets an agent rebase a unit branch, which rewinds runs/ under a live unit
assignee: PruszynskiJakub
labels:
  - friction
  - norn
workflow: triage
status: new
intake_at: 2026-10-29T12:53:05.566Z
body_hash: 0a6f07df1da524fa954d31b4c5a33ddd375cf6321418a4f5cd13777ae46f391c
---

## Observed
On gh-75, the merge agents of slices 07, 08 and 12 brought their branches up to date with
`git rebase <story branch>` ("as integrate does"). A slice branch carries norn's own
`runs/` commits (state.json, receipts), so the rebase checked out older copies of them in
the live unit worktree. Under 0.11.0, a tick then read the rewound state.json and
classified the run as died. It started a new implement session and wrote receipts that
clashed with committed ones, leaving 08 corrupt (S2: duplicate `0003-*.json`) and leaving
07 and 12 stopped halfway through the rebase with stray receipts. Each one needed cleaning
up by hand (move the receipts aside, `git rebase --abort`, restore state.json).

0.11.1 removes most of the damage: gh-79 holds a unit while a rebase is in progress, and
gh-80 makes integrate merge once the merge step has merged. But the agent can still rebase.
The unit is then held until someone ends the rebase, and the rebase still rewrites the
branch and its runs/ history.

## Wanted
The norn-merge skill tells the agent never to rebase a unit's branch (story or slice): it
merges the target in with `git merge --no-ff` and never rewrites the branch or force-pushes
it (GR4). "Any other conflict" step 1 says "merge, never rebase" instead of "merge by
default", and the skill no longer describes rebase as the way to bring a branch up to date.
Rebase stays only for a rebase that was already in progress when the agent arrived; even
then, aborting it and merging may be the better rule. Optionally, `norn done` from a merge
step refuses while a rebase is in progress in the worktree.

## Repro
In a slice workflow, let integrate conflict so the slice goes to `merge`. If the merge agent
runs `git rebase <story branch>` in the unit worktree, its runs/ files are rewound while the
unit is live. Seen on gh-75/07, /08 and /12 (handoff notes in their runs/ handoff.md).

## Where
- packages/cli/assets/skills/norn-merge/SKILL.md:21 ("merge by default") and :25 (`git rebase --continue`)
- packages/cli/src/runtime/integrate.ts (`bringInStory`: integrate merges after the merge step, gh-80)
- packages/core/src/decide/story.ts:260 (gh-79 hold while rebasing)

## PRD
GR4 (only the CLI rebases), W2 (`git: integrate`), S2, S5
