---
id: gh-119
slug: unit-worktrees-live-outside-the-project
provider: gh
number: 119
url: https://github.com/PruszynskiJakub/norn-next/issues/119
title: Unit worktrees live outside the project, in a sibling <repo>-worktrees/ folder
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:story
workflow: story
status: active
intake_at: 2026-10-30T15:18:10.423Z
body_hash: 2f0e71de381982cc2f5b8e5d66d48315092f5ada5644b000d7fbf5c409eab87f
---

## Observed

norn puts every unit worktree beside the repo, not inside it: a story worktree is `<repo>-worktrees/<story>-<slug>`, a slice worktree `<that>--<nn>-<slug>` (e.g. `~/Projects/norn-worktrees/gh-71-approving-triage-s-confirm-gate-ends-the` for `~/Projects/norn`). The location is fixed in code, with no config, and is built separately in three places: the start command, the view's scan and observe's orphan check.

So norn's working copies sit in a folder outside the project the person opened: the parent directory gets one extra folder per repo, and a tool or session scoped to the project (editor, agent permissions, sandbox, `ls`) doesn't see them.

## Wanted

Unit worktrees live inside the project, in a gitignored folder norn owns, so the project folder contains everything norn makes for it. Refine settles:

- The folder: e.g. `.norn/worktrees/` (gitignored, written by `norn init` like `.env.norn`/`.norn-unit` today) or one under `.git/` (never tracked, no ignore rule needed); whether it is configurable.
- One place that computes a unit's worktree path, used by the start command, the tick (K5), observe and the view's scan (X1).
- Moving existing worktrees: units in flight keep working (`git worktree move`, or old paths still read until their story finishes); `norn tidy` handles orphans in both places.
- Effects of nesting: tools run in the main checkout (`bun test`, `tsc`, linters, file watchers, editor indexing) must not walk into the worktrees; `norn init` from a worktree (#62) and hooks (A3) keep working.

## Where

- `packages/core/src/commands.ts:15`, `:17`: story and slice worktree paths for the start command
- `packages/store/src/worktree.ts:123`: `scanWorktrees`, the view finds unit worktrees in `<repo>-worktrees`
- `packages/cli/src/runtime/observe/index.ts:139`: orphan worktrees recognised by the `<repo>-worktrees/` prefix
- `packages/schema/src/ids.ts:196`, `:201`: `storyDirName` / `sliceDirName`
- `.gitignore`: norn's machine-local entries (`.env.norn`, `.norn-unit`)

## PRD

GR3 (one worktree per slice branch), K5 (slice worktrees created and removed by the tick, `norn tidy`), A3 (hooks only in worktrees with `.norn-unit`), A6 (`NORN_HOME` is the worktree), X1 (view reads), §7 layout. Related: #62, #91, #110, #117.
