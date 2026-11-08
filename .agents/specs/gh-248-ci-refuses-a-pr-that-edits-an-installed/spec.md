---
id: gh-248
slug: ci-refuses-a-pr-that-edits-an-installed
provider: gh
number: 248
url: https://github.com/PruszynskiJakub/norn-next/issues/248
title: CI refuses a PR that edits an installed bundled skill copy outside a release
assignee: PruszynskiJakub
labels:
  - friction
  - norn
  - norn:kind:bug
  - norn:priority:low
  - norn:risk:medium
  - norn:wf:quick
workflow: quick
status: active
intake_at: 2026-11-07T22:33:43.386Z
body_hash: a3767a37bc9f49185fd51fc5414c98335f15e801c7c4d5486e3e366e0c8bca20
---

## Observed

gh-226's implement edited `.agents/skills/norn-review/SKILL.md`, the installed copy, as well as its source. Since #254 nothing holds the unit. Its later steps run on the edited copy, and the inbox hint says "runs use this worktree's copies until the base is merged in", which is wrong for an edit the branch made itself. Once the PR merges, `norn upgrade` silently reverts the edit. Nothing catches it.

## Wanted

- The CI process check (`scripts/process-check.ts`) fails a PR whose diff touches `.agents/skills/norn-*` unless it is a release PR. It says to edit `packages/cli/assets/skills/` instead.
- `skillsDriftHint.unit` (`packages/core/src/commands.ts:129`) names both causes in one line: merge the base in, or revert this branch's edit to the copy.

## Out of scope

A new observed fact that tells a branch-own edit from a stale base (a git diff in observe, new inbox items and snapshots) for a mistake seen once.

## Rules

SK1; AGENTS.md "Bundled vs repo-local skills".
