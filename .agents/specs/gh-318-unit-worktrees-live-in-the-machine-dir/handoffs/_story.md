# gh-318 — handoff

## Goal

Unit worktrees are created in the checkout's machine dir (`<machine dir>/worktrees/<story>-<slug>[--<nn>-<slug>]`), never in `<repo>-worktrees/`.

## Proof

Built and QA'd at 2a61bb35: all 16 criteria `pass` (QA evidence pack in this run's evidence: one `<id>.md` per criterion, `observe*.ts` scripts and their outputs, `report.md`).
- Story worktree at `<machine dir>/worktrees/<story>-<slug>`, slice worktree beside it (`--<nn>-<slug>`): seen in `git worktree list` from real ticks over the cli harness (real git, fake gh).
- Bound home (NORN_HOME_DIR and the command's home override) and two clones each land in their own machine dir; nothing named `*-worktrees` beside any repo; the harness cleanup guard throws if one appears (`test/support/harness.ts`).
- Inbox start command, `story start`, `--print`, Herdr tab cwd, `norn brief`, `status --json` reach and `story list` root all show the machine-dir path; `tidy` reports a clean and a dirty orphan there and removes only the clean one; `story start` recreates a deleted worktree.
- Golden: `bun run golden -- --update` → 0 of 136 changed; at slice 01's commit decisions were byte-identical to base with only `facts.repo.worktrees` added; at HEAD decisions equal base modulo the worktree folder prefix.
- `git grep -e '-worktrees'` at HEAD: nothing in `packages/*/src` or docs; tests keep only the harness guard. `docs/concepts.md` run-state paragraph and glossary name `<machine dir>/worktrees/`.
- `bun run test:e2e` at HEAD: 74 pass, no pinned file rewritten. Unit tier + typecheck: test#1 check pass.

## Easy to miss

- Core is pure: the folder reaches decide as `Facts.repo.worktrees`, never by calling the machine dir from core.
- macOS `/var` vs `/private/var`: worktree paths sit under the home; compare against `git worktree list`.
- `git grep -- '-worktrees'` silently treats the pattern as a path: use `git grep -e '-worktrees' <rev> -- packages/` (a `packages/*/src` pathspec glob also missed nested files).

## Not proven yet

- The integration tier as a whole: CI run 1 failed one test on shard 3/4 (fixed below) and cancelled shards 1/4 and 2/4, so those two have not reported on this branch yet. Locally only `upgrade.test.ts` (26 pass) and `layout-guard.test.ts` (13 pass) were run.

## Notes

- ci fix round 1: `upgrade.test.ts` "in a unit worktree: exit 3, do_instead names the main checkout's path (B16)" failed because `h.worktree("gh-4-four")` is now inside the machine dir, and the fixture `toOldLayout` moves the whole machine dir to `.agents/norn/trace`, so the worktree no longer existed there. Fixed in the test: it makes a linked worktree beside the checkout with the unit's marker (as layout-guard's B18 does). I tried keeping `worktrees/` in place in `toOldLayout`, but it makes every old-layout fixture read as `both_layouts`: a non-empty machine dir counts as the new place. Real old-layout repos never have that, so no product change.

- Person decided (refine): no compatibility with `<repo>-worktrees/`; repo moves and doctor's adoption advice out of scope; worktrees in the per-checkout machine dir, not a shared `~/.norn/worktrees/`.
- Person agreed (plan): seams S1 (cli integration harness) and S2 (decide through Facts), prefactors first, harness check at cleanup (D4), golden corpus rewritten mechanically (D5).
- Slicing: the plan still holds on this base: the old path is built in exactly the places the plan lists. Slices 01 and 02 run in parallel; critical path is two levels (01 or 02 → 03). Slice 02's helper computes the old folder itself so it need not wait for 01; slice 03 points it at `worktreesDir`.
- Slice 03 is the largest; kept whole because the move and recognition must change together to stay green. Its Notes name the fallback split (the tests for home, clones, tidy, gone-check and view into a follow-up slice) if it outgrows one context.
- Slice 01 adds a field to observe's output, so observe snapshots change by that field only.
- QA: `story start --print` on an agent step running in auto is refused (`nothing_to_open`); the person-facing paths were checked on an attended step in manual mode.

## Resume

Wait for the ci check on the next push; if an integration shard fails, run that file with `bun test --config=bunfig.integration.toml --timeout=20000 <file>`.
