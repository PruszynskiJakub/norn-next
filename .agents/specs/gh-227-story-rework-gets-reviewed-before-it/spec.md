---
id: gh-227
slug: story-rework-gets-reviewed-before-it
provider: gh
number: 227
url: https://github.com/PruszynskiJakub/norn-next/issues/227
title: Story rework gets reviewed before it reaches the PR
assignee: PruszynskiJakub
labels:
  - norn
  - norn:kind:feature
  - norn:priority:medium
  - norn:risk:medium
  - norn:wf:quick
workflow: quick
status: new
intake_at: 2026-11-07T22:33:43.386Z
body_hash: 820291bee751b81d0dd311eefa4d88ead09d7353d10d903eb60e3fde89369f02
---

## Observed

In `story`, `implement` is entered only from rework edges (`test.fail`, `qa.fail`, `human-qa.reject`, `ci.fail`, `ready.reject`), and goes `implement → test → qa → describe` with no review. `quick` does re-review its rework. Each slice is reviewed before it integrates, so the unreviewed part is exactly the story-level rework.

## Wanted

- `implement.done → review`, a `review` step (`norn-review`, inputs `[spec, diff, last_findings]`), `approve → test`, `changes_requested → implement` counted by `review_loop`.
- A story round with no rework never runs it.
- Both copies (`packages/cli/assets/workflows/story.yaml`, `.agents/workflows/story.yaml`) and the §11.1 `story` sketch in `.agents/RULES.md`.

## Out of scope

A review between `test` and `qa` on every story (the earlier proposal). It would re-review slices that are already reviewed, and re-reviews mostly re-flag what was there before (#225).

## Rules

W1, W4, W5.
