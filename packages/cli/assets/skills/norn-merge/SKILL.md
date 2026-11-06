---
name: norn-merge
description: Resolves merge, rebase or cherry-pick conflicts by the intent of both sides and proves it with the tests, or aborts when a resolution needs new behaviour. Use when git stopped on conflicts or a branch must take in its base. Not for merging a pull request.
---

# Merge

Without this, conflicts get resolved by picking a winner and one side's work quietly disappears. You are combining work: both sides' intended behaviour survives. Commit locally; never push.

## Start in the right mode

| You find | Mode | Do |
|---|---|---|
| Your Rework section has **Base update (merge skill, base mode)** with a base commit | base | `git merge --no-ff <base commit>` in this worktree. |
| A slice whose `integrate` reported a conflict (Rework: "rebase onto `<story branch>` conflicts in …"); nothing is in progress | slice | `git merge <story branch>` in the slice worktree. |
| A merge, rebase or cherry-pick already in progress (`git status`) | in progress | Resolve it and continue that operation. |
| None of these, asked to bring a branch up to date | — | Merge its target in, like base mode. |

**Never start a rebase**, whatever the Rework wording says: only the tooling that runs this work rebases. A published story branch is never rebased; a slice that merged its story branch in is taken in by a merge at `integrate`, so the resolution is not linearised away and the same conflict does not come back.

## Resolve each conflict by intent

For each hunk, read the primary sources on both sides: the commits that touched those lines (`git log -p --merge -- <file>`; for the base side, `git log <merge base>..<base commit> -- <file>`), their messages, the spec and criteria each side serves, and the tests each side added.

- Both added different things: keep both, in a sensible order.
- One side refactored, the other changed behaviour: apply the behaviour change to the refactored code.
- Both changed the same behaviour differently: follow the spec of the work on this branch and note the trade-off in the merge commit message. When the spec does not say which wins, stop.
- A generated file (lockfile, emitted schema, generated doc block): take either side, then regenerate it with the repo's command once the sources are resolved.

Never take a side wholesale: no `-X ours/theirs`, `git checkout --ours/--theirs`, `--skip`, or a reset that drops either side. Resolve to existing behaviour only.

Then look for semantic conflicts: code that merged cleanly but calls something the other side renamed, duplicates logic, or breaks the other side's tests.

## Prove it and finish

1. Run the checks the repo names for local work (its `AGENTS.md`, or the test command your instructions name), not tiers it reserves for CI. Both sides' tests must pass; fix what the merge broke.
2. `git add` the files and conclude the operation (`git commit --no-edit`, or with the trade-off noted; `--continue` for one already in progress) until it completes.

## Stop when

- Keeping both intents needs behaviour that neither side has (a new rule, a product decision).
- The sides contradict each other and the spec does not say which wins.
- You cannot tell what one side meant.

Then abort (`git merge --abort`, `git rebase --abort` or `git cherry-pick --abort`) so the worktree is clean, and report why with the stuck report your instructions name: which files, what each side wants, the decision needed.

Done when no conflict markers remain, the operation is concluded and committed, both sides' behaviour and tests survive and the checks pass; or, when you stopped, the operation is aborted, the worktree is clean, and you said which decision is needed.
