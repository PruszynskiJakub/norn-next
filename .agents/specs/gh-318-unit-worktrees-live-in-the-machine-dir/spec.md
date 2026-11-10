---
id: gh-318
slug: unit-worktrees-live-in-the-machine-dir
provider: gh
number: 318
url: https://github.com/PruszynskiJakub/norn-next/issues/318
title: Unit worktrees live in the machine dir next to the run state, not beside the repo
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:refinement
workflow: refinement
status: new
intake_at: 2026-11-10T08:46:51.720Z
body_hash: e53bb9d21a1bc4f7007aa64f28b0f697fa68cfb9bf25b42f02208412207efce9
---

## Problem

Unit worktrees are created beside the repository, in `<repo>-worktrees/<story>-<slug>` (slices at `<story worktree>--<nn>-<slug>`). Every other machine-local file of a checkout (run state in `runs/`, hooks, locks, caches) already lives in the machine dir, `<norn home>/repos/<id>/`. The worktrees are the one thing norn still puts next to the person's projects, so a `<repo>-worktrees` folder appears in their projects folder for every repo norn runs in.

## Wanted

Unit worktrees live in the machine dir next to the run state, e.g. `<machine dir>/worktrees/<story>-<slug>[--<nn>-<slug>]`, so everything norn keeps per checkout is in one place under the norn home.

## Where the convention lives today

- `packages/core/src/commands.ts` `storyWorktreePath` / `sliceWorktreePath`, used by decide (`decide/index.ts`, `decide/steps.ts`), `store/local-facts.ts`, `cli/runtime/agent-unit.ts`, `cli/runtime/checkout.ts`
- `packages/store/src/worktree.ts`: `inferUnitMarker` (path prefix) and `scanWorktrees` (the view's scan)
- `packages/cli/src/runtime/observe/index.ts`: orphan worktrees by path prefix
- `packages/cli/src/commands/story-start.ts`: `worktreeGone` lists the parent folder

## Notes

- Core stays pure: it cannot call `machineDir()`, so the worktrees dir has to come in through Facts (e.g. on `facts.repo`), filled by observe.
- The location then follows the bound norn home (`--home`, `NORN_HOME_DIR`), as `runs/` already does.
- Observe snapshots and e2e transcripts that pin `-worktrees` paths change.
- Paths get longer and sit under a hidden folder: `story start --print`, Herdr tabs, editors and agents' folder-trust prompts all see the new path.

## Open questions

- Existing worktrees in `<repo>-worktrees/`: leave them where they are (still recognised, only new checkouts go to the machine dir), or have `norn upgrade` / doctor `git worktree move` the idle ones (no live run, claim not held elsewhere)?
- Does anything rely on the worktree being a sibling of the repo (relative paths in configs, tooling that looks at the parent folder)?
