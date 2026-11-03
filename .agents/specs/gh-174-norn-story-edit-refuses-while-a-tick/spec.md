---
id: gh-174
slug: norn-story-edit-refuses-while-a-tick
provider: gh
number: 174
url: https://github.com/PruszynskiJakub/norn-next/issues/174
title: norn story edit refuses while a tick holds the lock, so a workflow switch needs repeated retries
assignee: PruszynskiJakub
labels:
  - friction
  - norn
  - norn:wf:refinement
workflow: refinement
status: active
intake_at: 2026-11-03T11:42:41.614Z
body_hash: 80b337150ff4bca59d7991b999de3e700ac9bd5782416117e9d9f5bb4db96428
---

## Observed

`norn story edit --workflow` and `--at` refuse with `tick_locked` ("a tick is running, retry when it finishes") whenever a tick holds the lock (`packages/cli/src/commands/story-edit.ts:90`, `:175`). With `watch` running in auto mode a tick holds the lock most of the time (#78: remote-sync ticks take ~9s), so switching #157 from triage to quick took repeated retries.

## Wanted

`story edit` succeeds without the person retrying by hand. Either:

- it waits for the lock up to a timeout, printing that it is waiting, or
- it queues the edit (e.g. as a mailbox receipt) that the next tick applies under its own lock.

Queueing changes when the workflow pin moves, which is exactly the race in #143, so design the fix together with #143.

## Where

- `packages/cli/src/commands/story-edit.ts`

## Rules

S7, RD4. Related: #143, #78.
