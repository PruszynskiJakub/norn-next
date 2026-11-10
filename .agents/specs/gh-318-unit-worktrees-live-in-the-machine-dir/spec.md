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
status: active
intake_at: 2026-11-10T08:46:51.720Z
body_hash: e53bb9d21a1bc4f7007aa64f28b0f697fa68cfb9bf25b42f02208412207efce9
---

# Unit worktrees live in the machine dir next to the run state, not beside the repo

## Problem Statement

A person who runs norn in a repository finds a `<repo>-worktrees/` folder appear next to it in their projects folder, one per repository norn runs in, holding every story and slice worktree. Everything else norn keeps per checkout (run state, hooks, locks, caches) already lives in the checkout's machine dir under the norn home, `<norn home>/repos/<repo folder>-<hash>/`. The worktrees are the one thing norn still scatters among the person's own projects, so their projects folder fills with norn's working copies and the per-checkout files are split across two places.

## Solution

norn creates unit worktrees inside the checkout's machine dir, in a `worktrees/` folder next to `runs/`: a story worktree at `<machine dir>/worktrees/<story>-<slug>` (by default e.g. `~/.norn/repos/norn-next-ab12cd34/worktrees/gh-318-unit-worktrees-live-in-the-machine-dir`), a slice worktree beside its story's at `<machine dir>/worktrees/<story>-<slug>--<nn>-<slug>`. norn never creates a `<repo>-worktrees/` folder again, and nothing in norn looks there any more. Every place that shows a worktree path shows the new one.

## User Stories

1. As a person, I want `norn sync` (and `norn story start` when it creates the worktree) to create a story's worktree at `<machine dir>/worktrees/<story>-<slug>`, so that no folder of norn's appears in my projects folder.
2. As a person, I want a slice's worktree created at `<machine dir>/worktrees/<story>-<slug>--<nn>-<slug>`, beside its story's worktree in the same `worktrees/` folder, so that a story's worktrees stay together.
3. As a person, I want no `<repo>-worktrees/` folder created beside my repository by any norn command, so that my projects folder holds only my own checkouts.
4. As a person with a norn home bound by `--home` or `NORN_HOME_DIR`, I want worktrees created under that home's machine dir, so that worktrees follow the home exactly as run state does.
5. As a person with two clones of one repository, I want each clone's worktrees in its own machine dir, so that the same story key (`gh-12`) in both clones never shares a folder.
6. As a person, I want `norn story start --print`, the inbox's start command, the brief and Herdr tabs to show the worktree's path in the machine dir, so that the command I copy or the tab I open lands in the real worktree.
7. As a person, I want `norn tidy` to report and remove orphan worktrees (a norn-shaped worktree whose story is unknown here) found in the machine dir's `worktrees/` folder, still removing only clean ones, so that clean-up keeps working at the new location.
8. As a person, I want `norn story start` to notice a story worktree that was deleted from the machine dir's `worktrees/` folder as it did beside the repo, so that a missing worktree is recreated or reported, not silently assumed present.
9. As a person reading the view (`norn status`, the dashboard), I want unit worktrees found in the machine dir's `worktrees/` folder, so that every unit shows its worktree.
10. As a person, I want the docs to say that unit worktrees live in the checkout's machine dir, under `worktrees/`, so that I know where to find them.

## Out of Scope

- Worktrees in an existing `<repo>-worktrees/` folder: no moving, migrating or recognising them — there are no existing users to carry over.
- A repository folder that moves (its machine dir changes) and doctor's advice for adopting an orphaned machine dir — not changed by this story.
- A configurable worktree location — the machine dir is the one place.
- A shared top-level `~/.norn/worktrees/` folder — rejected: worktrees stay next to their checkout's run state, and story keys collide across repositories and clones.

## Further Notes

- Nothing in norn relies on a worktree being a sibling of the repository (no config, hook or `.env.norn` uses a path relative to the repository's parent folder); only the path convention itself and the places that recognise worktrees by the old folder change.
- Paths get longer and sit under a hidden folder (`~/.norn`): editors and agents' folder-trust prompts see the new path, as they already see a new folder for every new worktree.
- Pinned observe snapshots, e2e transcripts and golden cases that hold `-worktrees` paths change with this story.
