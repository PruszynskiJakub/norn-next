---
id: gh-80
slug: integrate-s-rebase-drops-the-merge-step
provider: gh
number: 80
url: https://github.com/PruszynskiJakub/norn-next/issues/80
title: Integrate's rebase drops the merge step's resolution and conflicts again
assignee: PruszynskiJakub
labels:
  - friction
  - norn
workflow: triage
status: new
intake_at: 2026-10-28T13:34:51.169Z
body_hash: 2cb900933ac22c364522892f65eaf0f38674657dd1ed12816fcaa68e9efe6946
---

## Observed

Slice gh-75/01, `slice` workflow, trace `.agents/norn/trace/2026-10-28.jsonl` (UTC):

- 10:54:36 `git.integrate` → `conflict` (receipt 0017-classify: "rebase onto gh-75-regroup-the-cli-around-status-story-and conflicts in packages/cli/src/cli.ts, packages/cli/src/commands/run-list.ts, packages/cli/src/commands/run-view.ts, packages/view/src/format.ts"). The slice went to `merge`, `conflict_loop` 1/2.
- The git adapter aborts a conflicting rebase, so merge#1 started with nothing in progress. The norn-merge skill says "when nothing is in progress, bring the branch up to date … (merge by default)", so the agent ran `git merge --no-ff` of the story branch: merge commit `a5a751e` (parents `1a61b23`, `71f309e` = story tip). It resolved the four files, ran typecheck and `bun test` (1239 pass) and reported done (receipt 0020-done). `norn done` accepted it.
- 11:04:43 `git.integrate` ran a plain `git rebase <story>`. Without `--rebase-merges` a rebase drops merge commits and replays the slice's own commits on the story tip, so the resolution in `a5a751e` was thrown away. Same conflict, same four files (receipt 0021-classify); `conflict_loop` 2/2.
- merge#2 then rebased by hand (see #79). The slice was integrated around 13:10 with linear history.
- Net: a correct, tested resolution wasted, one agent run lost, the conflict budget spent on one conflict.
- Plain git (2.50.1): after the slice merges the story branch and resolves it, `git merge-base --is-ancestor story HEAD` is true, yet `git rebase story` stops again with "Could not apply … " on the same file.

## Wanted

A conflict resolved once in `merge` stays resolved when the workflow returns to `integrate`: what the merge step does and what integrate repeats agree. Possible directions:
- integrate keeps the merge commit (e.g. `--rebase-merges`, or fast-forward when the story branch is already an ancestor of the slice HEAD); or
- the merge step's brief says to rebase onto the story branch (not merge), and `norn done` refuses until the slice HEAD contains the story tip with linear history and no rebase in progress, as BS5 already does for the base update.

## Repro

1. Story branch S and slice branch L change the same lines of `f` after the fork.
2. Integrate returns `conflict`; the adapter aborts the rebase; the slice goes to `merge`.
3. In the slice worktree: `git merge --no-ff S`, resolve, commit. S is now an ancestor of HEAD.
4. `norn done`: accepted. Integrate runs `git rebase S`: same conflict in `f`, counter goes up.

## Where

- `packages/adapters/src/git/index.ts:437-445`: `rebase` runs plain `git rebase <onto>` (no `--rebase-merges`, no rerere); on conflict lists the files and runs `git rebase --abort`.
- `packages/cli/src/runtime/integrate.ts:21-23`: integrate always rebases first, never checks whether the story branch is already in the slice HEAD.
- `packages/cli/src/runtime/act/git-step.ts:77-83`: rebase conflict → outcome `conflict`, paths only in `detail`.
- `packages/cli/assets/workflows/slice.yaml:41-49`, `bug.yaml:41-49` and the copies in `.agents/norn/workflows/`: `merge` done → `integrate`, `means: "conflicts resolved keeping the intent of both sides; tests pass"`.
- `packages/cli/assets/skills/norn-merge/SKILL.md:21`: "merge by default"; never says integrate will rebase afterwards.
- `packages/core/src/brief.ts:566-576`: merge instructions only for base mode (`rw.base`).
- `packages/cli/src/commands/done.ts:99-102,185-186`: `verifyBaseMerge` runs only for the base update; after an integrate conflict `norn done` checks nothing about git state.

## PRD

- W2: `git: integrate` = "rebase + fast-forward, serialized per story". K6: a non-clean rebase or merge yields `conflict`. W4: counters on cycles — `conflict_loop` spent with no new conflict.
- GR4: "Only the CLI rebases, integrates and pushes" — merge-by-default in a slice and merge#2's manual rebase both sit badly against it.
- BS4/BS5: merge-never-rebase and the done check exist only for the base update. Skills table: norn-merge = "merge the base into a published branch, never rebase".
