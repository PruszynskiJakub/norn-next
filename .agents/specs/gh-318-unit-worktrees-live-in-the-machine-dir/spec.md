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
  - norn:wf:story
workflow: story
status: active
intake_at: 2026-11-10T08:46:51.720Z
body_hash: e53bb9d21a1bc4f7007aa64f28b0f697fa68cfb9bf25b42f02208412207efce9
refined_body_hash: e53bb9d21a1bc4f7007aa64f28b0f697fa68cfb9bf25b42f02208412207efce9
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

## Plan

### Seams
- **S1 cli, through the integration harness (`createHarness`: `h.norn(…)` against a temp repo, its `~/.norn` home and the fakes).** Observes where `norn sync`, a slice start, `norn story start` (and `--print`, the Herdr tab's cwd), `norn tidy`, `norn status` and the brief put or find a worktree, and that no `<repo>-worktrees/` folder appears; with a second home or a second clone, that worktrees follow the home and the clone.
  Prior art: `story-start.test` (gone-check, `--print`, Herdr tab), `housekeeping.test` (orphan worktrees in tidy), `machine-dir.test` and `run-state-machine-dir.test` (files under the bound home), `mailbox-across-machines.test` (two clones of one remote), `story-view.test` (status of a unit's worktree).
- **S2 core `decide`, through `Facts` → `Decision[]`.** Observes that the story and slice worktree paths decide puts in intake and slice-start actions, and every command built from them (inbox start command, brief paths), come from the worktrees folder observe reports, not from the repo root.
  Prior art: `decide.test`, `handoff-inbox.test`, `brief.test`, the golden corpus (`golden.test`).

### Coverage
| User story | Seam | Test kind | Notes |
|---|---|---|---|
| 1. `norn sync` / `story start` create the story worktree at `<machine dir>/worktrees/<story>-<slug>` | S1 | integration | path asserted through `machineDir`, never by hand |
| 2. a slice worktree at `<machine dir>/worktrees/<story>-<slug>--<nn>-<slug>` | S1 | integration | S2 pins the path decide derives from the fact |
| 3. no `<repo>-worktrees/` folder from any command | S1 | integration | a harness-wide check at cleanup (D4) |
| 4. worktrees follow a home bound by `--home` / `NORN_HOME_DIR` | S1 | integration | |
| 5. two clones never share a worktree folder for one story key | S1 | integration | two clones of one remote, as `mailbox-across-machines.test` |
| 6. `story start --print`, the inbox's start command, the brief, Herdr tabs show the new path | S1 | integration | inbox and brief rendering already pinned at S2 from the unit's worktree path |
| 7. `norn tidy` reports and removes clean orphan worktrees in the machine dir's `worktrees/` | S1 | integration | |
| 8. `story start` notices a story worktree deleted from `worktrees/` | S1 | integration | |
| 9. the view finds unit worktrees in `worktrees/` | S1 | integration | `norn status --json` |
| 10. the docs say where worktrees live | — | review | concepts.md (run state paragraph and glossary's worktree row) |

### Prefactoring
1. **One place names the worktrees folder.** Store gains `worktreesDir(root)` beside `machineDir` in its paths; core's `storyWorktreePath` takes that folder instead of the repo root; `Facts.repo` gains `worktrees` (filled by observe and by the view's facts), and decide reads it from there. Every caller that builds or recognises a unit worktree path goes through it: decide's intake and slice start, `loadLocalFacts`, the checkout of a story, `unitStoryMode`, observe's orphan check, `inferUnitMarker`, `scanWorktrees`, `story start`'s gone-check. `worktreesDir` returns `<repo>-worktrees` at first, so nothing changes; the existing golden cases get `repo.worktrees` set to that old folder and decide the same. Makes stories 1–9 a one-line change in where the folder is, and keeps core pure.
2. **Tests name worktrees through the harness.** The harness gains `h.worktree(<dir name>)` (and the same for a second clone), and the integration and e2e tests and the transcript's watched folders use it instead of spelling `${h.root}-worktrees/…`. Makes the move touch one helper instead of ~80 test files, for stories 1–9.

### Implementation decisions
- D1 The worktrees folder reaches decide as a fact, `Facts.repo.worktrees` (absolute path) — core cannot read the machine dir, and a fact keeps golden cases replayable as recorded.
- D2 `worktreesDir(root)` is `<machine dir>/worktrees`; story and slice folder names are unchanged (`storyDirName`, `<story dir>--<sliceDirName>`). git creates the missing parent folders on `worktree add`, so no new mkdir.
- D3 Recognition moves wholesale: `inferUnitMarker`, observe's orphan check, `scanWorktrees` and `story start`'s gone-check look only under `worktreesDir(root)`; nothing looks at `<repo>-worktrees/` (the person ruled out compatibility).
- D4 The harness checks at cleanup that no `<repo>-worktrees` folder exists beside its repo, so every integration test guards story 3, not one hand-picked test.
- D5 The golden corpus: its recorded paths are rewritten mechanically from `<dir>/repo-worktrees/` to the machine dir's `worktrees/`, with `repo.worktrees` to match, then `bun run golden -- --update` must show no decision change — the corpus shows the paths norn makes, and the replay proves decide is path-agnostic. Observe snapshots and e2e transcripts are rewritten by their own update commands; the diff is paths only.

### Testing decisions
A good test drives `norn` through the harness and checks the folder on disk, the JSON a command prints, or the fake Herdr's tab cwd; paths come from store's `machineDir`/`worktreesDir` and the harness helper, never typed. Decide tests build `Facts` with a worktrees folder and check the actions' paths. Faked: only the system boundaries the harness already fakes (remote, runner, Herdr, notifier, clock); git and the file system are real.

### Risks
- A caller still building `<repo>-worktrees` by hand that no test reaches (adapters, view, a refusal's `do_instead`): prefactor 1 lands first and a grep for `-worktrees` in `packages/*/src` must come back empty; D4 catches any command that still creates one.
- macOS temp paths (`/var` vs `/private/var`) and the realpath of the home: the machine dir is under the home now, so a worktree path compared against `git worktree list` output may differ in spelling where the repo root did not; the gone-check and orphan check are the first slice to prove on the real path.
- Pinned outputs churn (≈130 golden cases, four observe snapshots, three transcripts): rewritten mechanically in one commit, reviewed as paths-only.
