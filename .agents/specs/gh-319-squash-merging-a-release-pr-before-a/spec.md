---
id: gh-319
slug: squash-merging-a-release-pr-before-a
provider: gh
number: 319
url: https://github.com/PruszynskiJakub/norn-next/issues/319
title: Squash-merging a release PR before a sync reads as the base moving, and norn opens a second PR for the same release
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: active
intake_at: 2026-11-10T09:46:52.315Z
body_hash: e89b8838ac98cf459effa91fce6d7028a31d74a63fa59c235f09378257036f2e
---

## Observed

Seen with norn 0.28.0 on gh-298 (Release 0.29.0).

1. 12:18:41: `open-pr` opens draft #299. At 12:24:05 the person squash-merges it into `main` (39a0dd2).
2. 12:24:45: PRs are fetched only on sync ticks, and a squash commit isn't on the story branch's history (no `merged_by_ancestry`). So decide sees `main` 1 commit ahead and classifies the `ready` gate `stale` ("base moved", route `update`). The person's `approve` at 12:24:45.515 is rejected: "stale: receipt for ready#1, cursor at update#1".
3. `git.update` merges `main` (that is, the release's own squash) into `gh-298-release`. `prepare` runs again, and at 12:26:05 `open-pr` opens **#300**, a second "Release 0.29.0" PR.
4. 12:34: `watch` restarts on 0.29.0 and releases the claim (see #294). The story stays at `ci`, unclaimed, tracking #300, which a person closed later. The cockpit shows it In flight as `ready ci · PR #300 closed`.

## Wanted

Before a story's gate goes `stale`, or an `update` runs, because the base moved, norn checks whether the base moved because the story's own PR merged. A merged story PR ends the story through the merge path (cleanup, done record), never by reworking it and opening another PR.

## Repro

In a throwaway repo under `$TMPDIR`, with `bun packages/cli/src/main.ts`: run a story whose workflow has an approval gate with a `stale` route after `open-pr` (as `release` does). While it is parked at the gate, squash-merge its PR on the remote, then let a non-sync tick run. The gate classifies `stale`, `update` merges the squash back in, and `open-pr` opens a new PR.

## Where

- `packages/core/src/decide/story.ts:542`: `gate.stale` classifies on the base alone.
- `packages/core/src/policy.ts:103` `mergedVia`: only `story.pr` (sync ticks only) or ancestry, which a squash merge never satisfies.
- Related: #294 (the claim released at the restart), #88 (a merged story PR ends the story).
