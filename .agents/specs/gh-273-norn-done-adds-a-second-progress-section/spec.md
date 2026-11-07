---
id: gh-273
slug: norn-done-adds-a-second-progress-section
provider: gh
number: 273
url: https://github.com/PruszynskiJakub/norn-next/issues/273
title: norn done adds a second Progress section when the handoff's headings are level 3
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:reproduce
workflow: reproduce
status: new
intake_at: 2026-11-07T09:59:04.159Z
body_hash: 7344eb87494d987938f303ea4d22e8cc5fa99411b81e2aa8b9e6eaa2aa3c0cac
---

## Observed

norn 0.25.0. `appendProgress` looks only for a level-2 `## Progress` heading. The brief shows the handoff under Context with its headings shifted down to `###` (`demoteHeadings(text, 3)`), and agents keep that shape when they write the file. When norn then appends its `- <step>#<n> <outcome>: <summary>` line, it finds no `## Progress` and adds a new `## Progress` section at the end of the file, after Resume.

`.agents/specs/gh-267-reshape-the-bundled-and-repo-local/handoffs/_story.md` ends with both sections: the agent's `### Progress` and norn's `## Progress`, which holds the same milestones again, one line per report. The duplicate goes into every later brief of the unit.

## Wanted

norn's milestone line goes into the handoff's existing Progress section at any heading level, and never creates a second one.

## Repro

1. Write a handoff whose sections are `### Goal`, `### Progress` and `### Resume`.
2. Report `norn done done --handoff "x"` in that unit.
3. The file now ends with a new `## Progress` section holding `- <step>#<n> done: x`.

## Where

- `packages/cli/src/runtime/report.ts:90-110` (`appendProgress`: regex `/^##\s+Progress\s*$/`)
- `packages/core/src/brief.ts:382` (`demoteHeadings(text, 3)`)
- Callers: `packages/cli/src/commands/done.ts:198`, `packages/cli/src/runtime/report.ts:86`, `packages/cli/src/runtime/checkout.ts:505`

## Rules

O6, S9
