---
id: gh-326
slug: ci-cancels-sibling-shards-on-the-first
provider: gh
number: 326
url: https://github.com/PruszynskiJakub/norn-next/issues/326
title: CI cancels sibling shards on the first failure, so one red run hides the other failing shards
assignee: PruszynskiJakub
labels:
  - norn
  - norn:kind:chore
  - norn:priority:high
  - norn:risk:low
  - norn:wf:quick
workflow: quick
status: done
intake_at: 2026-11-10T15:08:44.663Z
body_hash: 8fb5a47bed728a1bd84aff9d2d6ea707bb26b26376e1e73de608721c0c70d351
merge:
  pr: 333
  url: https://github.com/PruszynskiJakub/norn-next/pull/333
  head_sha: 71f20d835cd56f4345781cab987c5088f7042512
  merge_commit_sha: 1e0af1189ac2663f727fcd3db6b514f3b500981f
  merged_by: PruszynskiJakub
  merged_at: 2026-11-11T08:07:17.000Z
---

## Problem

Both sharded jobs in `.github/workflows/ci.yml` (integration, 4 shards; e2e, 3 shards) set `strategy.fail-fast: true`. When one shard fails, GitHub cancels the others, so a red run reports only the first failing shard. `.agents/scripts/ci-failures.sh` then lists only jobs with `conclusion == "failure"` and leaves out the cancelled ones, so the rework brief reads as if that shard were the only problem.

In gh-318 this turned one change into three ci loops. ci#1 failed shard 3 (B16), ci#2 failed shard 1 (`machine-dir.test.ts`), and B26 was already red on shard 2 in runs nobody read, because that shard kept getting cancelled. The implement agent even noted "shards 1/4 and 2/4 were cancelled by fail-fast, so their results are unknown", but the brief gave it no failures to fix there. The three loops used up `ci_loop`, which led to a stall. That cost about 30 minutes plus a person to unstick it.

## Wanted

- One CI run reports every failing shard: `fail-fast: false` on the integration and e2e matrices.
- `ci-failures.sh` also lists jobs that were cancelled or skipped, marked as "unknown, not run to the end", so a rework never takes a cancelled shard for a pass.

## Where

- `.github/workflows/ci.yml:38` and `:61`
- `.agents/scripts/ci-failures.sh` (the `select(.conclusion=="failure")` filter)

## Notes

- A red run then takes as long as its slowest shard (about 1 to 2 minutes), not its first failure. The ci check already waits on the whole run with `gh run watch`.
