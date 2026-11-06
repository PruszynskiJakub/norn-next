---
id: gh-226
slug: norn-review-checks-its-own-findings-and
provider: gh
number: 226
url: https://github.com/PruszynskiJakub/norn-next/issues/226
title: norn-review checks its own findings and reads a REVIEW.md
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: active
intake_at: 2026-11-06T08:01:58.202Z
body_hash: 1f088a56793863e684df680cc97004d2a8f4ff1e590c779ba0512ad1b9d19cad
---

## Observed

`norn-review` reports each axis once and decides from that; nothing checks a finding before it blocks. Its standards sources are `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, coding-standard docs and lint config. There is no place for a repo to say what to ignore (generated files, fixtures), what counts as failure for it, or to forbid nits.

Related: #206 borrows reviewer prompt craft from Limen; this issue is the verify pass and REVIEW.md, which #206 does not cover.

## Wanted

- A verify pass: before deciding, each blocking candidate is checked again (fresh subagent, or by re-reading the code it cites) and dropped if it does not hold.
- The skill reads `REVIEW.md` at the repo root when present: ignored paths, what failure means here, what not to report.
- Every finding names a file and line; the summary states the count and says plainly when there are none.
- `norn init` writes a short starter `REVIEW.md` (only when none exists).

## Where

`packages/cli/assets/skills/norn-review/SKILL.md` (steps 2–4), `norn init` assets.

## Rules

SK1, P7.
