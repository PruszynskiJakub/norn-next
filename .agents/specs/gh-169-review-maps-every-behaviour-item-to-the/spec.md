---
id: gh-169
slug: review-maps-every-behaviour-item-to-the
provider: gh
number: 169
url: https://github.com/PruszynskiJakub/norn-next/issues/169
title: Review maps every Behaviour item to the test that proves it
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: new
intake_at: 2026-11-03T10:52:31.990Z
body_hash: cbdabdc65eff442f374379a4d49e00db699da4644bd8f111e8320b7e825d1713
---

## Observed

The `norn-review` skill's Spec axis judges in prose whether a change does what was asked. It never has to show which test proves each Behaviour item or acceptance criterion. A review can therefore approve a change whose Behaviour items are only partly tested, and nothing in its findings makes the gap visible.

## Wanted

The Spec axis builds a table: one row per Behaviour item / acceptance criterion, with the test file and test name that proves it, or `UNTRACED`.

- An `UNTRACED` item is a blocking finding, unless the criterion's verifier is `agent` or `person` (QV1). Those items point at QA instead.
- The table goes into the review's handoff, so QA and the PR body can reuse it.

## Where

- `packages/cli/assets/skills/norn-review/SKILL.md` (and its copy in `.agents/skills/`)

## Rules

QV1, QV2.
