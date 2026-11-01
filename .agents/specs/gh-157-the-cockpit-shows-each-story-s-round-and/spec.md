---
id: gh-157
slug: the-cockpit-shows-each-story-s-round-and
provider: gh
number: 157
url: https://github.com/PruszynskiJakub/norn-next/issues/157
title: The cockpit shows each story's round and workflow
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: new
intake_at: 2026-11-01T20:22:43.336Z
body_hash: 695aff1f881184f17fff56b09df37cbd4b4eb6d2d6a403489896d67f62013657
---

## Observed

The cockpit never says which workflow a story is running. A row shows `<status> <step>` (`ready sync`) and the preview `ready at sync · auto · held here`. With stories going through rounds of single-purpose workflows (`triage → refinement → story`, `reproduce → quick`), the step name alone does not say which round a story is in. `norn story view` already prints it: `round 1 · quick · ready at sync · auto · held here`.

gh-147 left "how a story's stage is shown" to #136 (legs). This splits out the part that needs nothing from #136: each round already pins its workflow, and the preview report carries it.

## Wanted

- The preview's status line reads like `story view`: `round 1 · quick · ready at sync · auto · held here` (no `round` before the story starts).
- A story row shows the workflow before the step: `quick · ready sync`.
- Filtering (`/`) matches the workflow name.

The step count / chain-of-legs display and a new Now layout stay with #136.

## Where

- `packages/cli/src/runtime/cockpit-tui.ts:331-332` — `previewLines`, the status line.
- `packages/cli/src/runtime/cockpit-tui.ts:386` — `storySummary`, the row.
- `packages/cli/src/runtime/cockpit-tui.ts:82` — the filter text.
- `packages/view/src/orient.ts:20-22,212` — `OrientUnit.workflow` / `round`, and how `story view` writes them (gh-71 B28, D10).

## PRD

SPEC-cockpit CP3 (preview), B11; gh-71 B28 (round and workflow next to the step). Follows gh-147, splits from #136.
