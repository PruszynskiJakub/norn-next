---
id: gh-156
slug: the-backlog-tab-lists-open-norn-issues
provider: gh
number: 156
url: https://github.com/PruszynskiJakub/norn-next/issues/156
title: The Backlog tab lists open norn issues not assigned to me
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: done
intake_at: 2026-11-01T20:18:21.082Z
body_hash: 613a9c262646599f859d391672fb2df7af3f1eba7d6557bfe06d8d9b22bab8a7
merge:
  pr: 158
  url: https://github.com/PruszynskiJakub/norn-next/pull/158
  head_sha: a3444cf539e270140d10a7efc35fe0ca96e460e0
  merge_commit_sha: a5dcadf471d2764d4a95f4dfdb8096893de2fdfc
  merged_by: PruszynskiJakub
  merged_at: 2026-11-01T21:06:33.000Z
---

## Observed

Assigning an issue is how I choose when norn takes it in (GR1), so unassigned `norn` issues are my backlog — I leave issues unassigned on purpose, because intake cuts the story branch and worktree at once (GR2) and an early branch ages and conflicts. But the cockpit never shows them: the Backlog tab only lists taken-in, not-started stories (`storyTab`), and intake always starts a story at once (GR2), so the tab is always empty ("no story waits to start").

## Wanted

The Backlog tab lists open issues labelled `norn` and not assigned to me, with their number, title and labels. `t take` on such a row assigns the issue to me, and the next sync takes it in.

## Where

- `packages/view/src/cockpit.ts:114` — `storyTab`: backlog = `status === "not_started"` only.
- `packages/view/src/cockpit.ts:90` — `t take` today means `story checkout` (claim an unclaimed story); the new take on an issue row assigns instead.
- `packages/adapters/src/gh/index.ts:99` — the remote lists only issues assigned to `@me` with the label; the backlog needs the unassigned ones too (a remote port read, `packages/core/src/ports.ts`), and an assign effect (glab as well).
- `packages/cli/src/runtime/cockpit-tui.ts:424` — the empty text of the Backlog tab.

## PRD

GR1 (intake = assigned + labelled), GR2 (intake starts at once), SPEC-cockpit CP2 (tabs), B11 (`status --watch`).
