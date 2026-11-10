# gh-318 — handoff

## Goal

Unit worktrees are created in the checkout's machine dir (`<machine dir>/worktrees/<story>-<slug>[--<nn>-<slug>]`), never in `<repo>-worktrees/`.

## Proof

Review #1 at becfb596: unit tier 1734 pass, typecheck green. Built and QA'd at 2a61bb35: all 16 criteria `pass` (QA evidence pack in this run's evidence). Golden: 0 of 136 changed. e2e: 74 pass, no pinned file rewritten. `git grep -e '-worktrees'` finds nothing in `packages/*/src` or docs.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| 01.AC1 | decide puts the story and slice worktree paths and their start command under the reported worktrees folder | test | `packages/core/test/unit/decide.test.ts` › "worktree paths come from the worktrees folder observe reports" (both tests) |
| 01.AC2 | golden replay with the old folder as the fact: no decision change | test | `packages/core/test/unit/golden.test.ts` (replay of the corpus at slice 01; corpus rewritten since, see 03.AC10) |
| 01.AC3 | one store function names the folder; observe and view fill the fact from it | agent | QA (agent); review read `paths.ts:130`, `observe/index.ts:510`, `view/src/load.ts:463` |
| 02.AC1 | the harness names a unit worktree (and a clone's) by folder name | test | `test/support/worktree.ts` through `h.worktree`/`Clone.worktree`, used by every integration and e2e test; `worktrees-machine-dir.test.ts` › "the tick creates the story worktree…" asserts `h.worktree(DIR)` equals the machine-dir path |
| 02.AC2 | no hand-spelled `-worktrees` left in tests outside the helper | agent | QA (agent) |
| 03.AC1 / story 1 | `sync`/`story start` create the story worktree at `<machine dir>/worktrees/<story>-<slug>` | test | `packages/cli/test/integration/worktrees-machine-dir.test.ts` › "the tick creates the story worktree at <machine dir>/worktrees/…" |
| 03.AC2 / story 2 | a slice worktree at `…/worktrees/<story>-<slug>--<nn>-<slug>` beside the story's | test | `packages/cli/test/integration/worktrees-machine-dir.test.ts` › "the slice starts at <machine dir>/worktrees/…--<nn>-<slug>…" |
| 03.AC3 / story 3 | no `<repo>-worktrees` beside the repo after any integration test | test | `test/support/harness.ts` cleanup guard (throws), plus `besideRepo` checks in `packages/cli/test/integration/worktrees-machine-dir.test.ts` |
| 03.AC4 / story 4 | worktrees follow a home bound by `--home` or `NORN_HOME_DIR` | test | `packages/cli/test/integration/worktrees-machine-dir.test.ts` › "the tick creates the story worktree…" (NORN_HOME_DIR) and "a home given to the command…" |
| 03.AC5 / story 5 | two clones keep separate worktree folders for one story key | test | `packages/cli/test/integration/worktrees-machine-dir.test.ts` › "two clones of one remote take in the same story…" |
| 03.AC6 / story 6 | `--print`, the inbox start command, the brief and the Herdr tab show the machine-dir path | test | `packages/cli/test/integration/worktrees-machine-dir.test.ts` › "the inbox's start command, story start, --print and the Herdr tab's cwd…" and "the brief run from the worktree in the machine dir…" |
| 03.AC7 / story 7 | `tidy` reports a clean and a dirty orphan and removes only the clean one | test | `packages/cli/test/integration/worktrees-machine-dir.test.ts` › "a clean and a dirty orphan are both reported…" (canonical home only, see F1) |
| 03.AC8 / story 8 | `story start` notices a deleted story worktree and recreates it | test | `packages/cli/test/integration/worktrees-machine-dir.test.ts` › "a story worktree deleted from the machine dir's worktrees/…" |
| 03.AC9 / story 9 | `status --json` shows each unit's worktree in the machine dir | test | `packages/cli/test/integration/worktrees-machine-dir.test.ts` › "norn status shows the running story's worktree…" and the slice test (reach plus `story list` root); `packages/view/test/integration/view.test.ts` › "reads specs from story worktrees in the checkout's machine dir" |
| 03.AC10 | rewritten golden corpus: no decision change | test | `packages/core/test/unit/golden.test.ts` |
| 03.AC11 / story 10 | docs say worktrees live in the machine dir under `worktrees/` | agent | QA (agent); review read `docs/concepts.md` run-state paragraph and glossary |

Review findings (`findings.json` in this run): F1 blocking. `worktreesDir` uses an unresolved home but is prefix-matched against resolved `git worktree list` paths (`observe/index.ts:176`, `worktree.ts:91`). F2 minor: the decide fixture still reports `/r-worktrees`.

## Easy to miss

- Core is pure: the folder reaches decide as `Facts.repo.worktrees`, never by calling the machine dir from core.
- macOS `/var` vs `/private/var`: worktree paths sit under the home; compare against `git worktree list`.
- `git grep -- '-worktrees'` silently treats the pattern as a path: use `git grep -e '-worktrees' <rev> -- packages/` (a `packages/*/src` pathspec glob also missed nested files).

## Not proven yet

- A norn home reached through a symlink (F1): orphan detection and marker inference compare `${worktreesDir(root)}/` with resolved git paths. Not reproduced live; the shell hook refuses `git worktree add`. A harness test can reproduce it.
- The integration tier as a whole: CI shards 1/4 and 2/4 have not reported on this branch yet.

## Notes

- ci fix round 1: `upgrade.test.ts` "in a unit worktree: exit 3, do_instead names the main checkout's path (B16)" failed because `h.worktree("gh-4-four")` is now inside the machine dir, and the fixture `toOldLayout` moves the whole machine dir to `.agents/norn/trace`, so the worktree no longer existed there. Fixed in the test: it makes a linked worktree beside the checkout with the unit's marker (as layout-guard's B18 does). I tried keeping `worktrees/` in place in `toOldLayout`, but it makes every old-layout fixture read as `both_layouts`: a non-empty machine dir counts as the new place. Real old-layout repos never have that, so no product change.
- Person decided (refine): no compatibility with `<repo>-worktrees/`; repo moves and doctor's adoption advice out of scope; worktrees in the per-checkout machine dir, not a shared `~/.norn/worktrees/`.
- Person agreed (plan): seams S1 (cli integration harness) and S2 (decide through Facts), prefactors first, harness check at cleanup (D4), golden corpus rewritten mechanically (D5).
- Slicing: the plan still holds on this base: the old path is built in exactly the places the plan lists. Slices 01 and 02 run in parallel; critical path is two levels (01 or 02 → 03). Slice 02's helper computes the old folder itself so it need not wait for 01; slice 03 points it at `worktreesDir`.
- Slice 03 is the largest; kept whole because the move and recognition must change together to stay green. Its Notes name the fallback split (the tests for home, clones, tidy, gone-check and view into a follow-up slice) if it outgrows one context.
- Slice 01 adds a field to observe's output, so observe snapshots change by that field only.
- QA: `story start --print` on an agent step running in auto is refused (`nothing_to_open`); the person-facing paths were checked on an attended step in manual mode.

## Resume

Rework F1: resolve the norn home through realpath where it is bound or defaulted (`bindNornHome` and `machineHomeOf` in `packages/store/src/paths.ts`, e.g. with `realOr`), or inside `worktreesDir`. Add a test in `packages/cli/test/integration/worktrees-machine-dir.test.ts` with the command's home given as a symlink: a tidy orphan must still be reported, and a story worktree with its `.norn-unit` deleted must still be inferred. Then `bun run test` and `bun run typecheck`.
