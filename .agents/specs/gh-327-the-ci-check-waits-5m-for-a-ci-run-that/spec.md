---
id: gh-327
slug: the-ci-check-waits-5m-for-a-ci-run-that
provider: gh
number: 327
url: https://github.com/PruszynskiJakub/norn-next/issues/327
title: The ci check waits 5m for a CI run that a conflicting PR never gets, then sends the story to implement
assignee: PruszynskiJakub
labels:
  - norn
  - norn:kind:bug
  - norn:priority:high
  - norn:risk:medium
  - norn:wf:quick
workflow: quick
status: active
intake_at: 2026-11-10T15:08:44.663Z
body_hash: 1481602b42324df07715701cad3b23838648253528ae18abe9c46d2732fcace6
---

## Problem

The story workflow's `ci` check waits up to 5 minutes for a `ci.yml` run on the PR's head commit, then fails with "no ci.yml run for <sha> after 5m". GitHub starts no `pull_request` run while a PR conflicts with its base, so a conflicting PR always fails this way. The fail goes to `implement` and spends `ci_loop`, although there is nothing for implement to fix. The branch needs `update`.

In gh-318, PR #320 became CONFLICTING after other stories merged into main. ci#4 spent 9m19s waiting for a run that could not start, used up the last `ci_loop` slot, and the story stopped until a person unstuck it and reran from `update`.

## Wanted

- The ci check notices a PR that cannot merge (`gh pr view --json mergeable` is `CONFLICTING`) before it waits for a run, and the story goes to `update` (merge the base, `resolve` on conflict) without spending `ci_loop` or a 5-minute wait.
- `UNKNOWN` mergeability (GitHub still computing) is retried briefly, never treated as a conflict.
- The "no run after 5m" message names the PR's mergeable state when it does time out, so a person sees why.

## Where

- The `ci` step in `.agents/workflows/story.yaml` and in the shipped `packages/cli/assets/workflows/story.yaml` (change both); check whether `quick.yaml`'s `ci` step needs the same.
- Check outcomes are fixed to `pass` / `fail` / `exhausted` (`packages/schema/src/workflow.ts:210`).

## Decision

A check may declare extra outcomes by exit code. The `ci` check uses this to exit with a distinct code on a conflicting PR and declares it as `stale` → `{ to: update, counter: stale_loop }`. This is a workflow schema change, so it ships with its validator, docs (`bun run docs:emit`, `bun run schema:emit`) and golden cases. Plain `pass` / `fail` by exit 0 / non-zero stays the default for every check that declares nothing.

Rejected: running `update` before every `open-pr`. It narrows the window but a base that moves during CI still conflicts.
