---
id: gh-170
slug: the-brief-of-a-step-after-a-check-lists
provider: gh
number: 170
url: https://github.com/PruszynskiJakub/norn-next/issues/170
title: The brief of a step after a check lists the checks that ran and what they covered
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: new
intake_at: 2026-11-03T10:52:31.990Z
body_hash: 8a5a69ac3ec3b5f722d4587a19e27b50d743bb42637814d843cf0a283eb9d93d
---

## Observed

The brief for a review or QA step shows a check only when it failed, inside Rework (`packages/core/src/brief.ts:122`, `:225`). After a passing check, the reviewer doesn't know which checks ran or what each one covered.

In this repo the `story` workflow's `test` check runs the unit tier, the integration tier and the type check, but not e2e (`.agents/workflows/story.yaml:59`). A review approved a change while an e2e test was red; only the later `ci` check caught it, one round later.

## Wanted

The brief of a step after a check lists the checks that have run since the last implement: step, command, outcome, duration, and a pointer to the log. A reviewer can then say "e2e has not run yet" instead of assuming it has.

## Where

- `packages/core/src/brief.ts`

## Rules

B3.
