## Goal

Unit worktrees are created in the checkout's machine dir (`<machine dir>/worktrees/<story>-<slug>[--<nn>-<slug>]`), never in `<repo>-worktrees/`.

## Proof

Planned, nothing built yet. spec.md's Plan (agreed with the person) maps every user story to a seam: S1, the cli integration harness, for user stories 1–9; S2, core `decide` through Facts, pins the derived paths; the docs (user story 10) by review.

## Easy to miss

- Core is pure: the worktrees folder reaches decide as `Facts.repo.worktrees` (filled by observe and the view's facts), never by calling the machine dir from core.
- Every place that builds or recognises the old path must move: decide (intake, slice start), `loadLocalFacts`, the story checkout, `unitStoryMode`, observe's orphan check, `inferUnitMarker`, `scanWorktrees` (view, story close/reset), `story start`'s gone-check. A grep for `-worktrees` in `packages/*/src` must come back empty.
- macOS `/var` vs `/private/var` spelling: the worktree path now sits under the home; check comparisons against `git worktree list`.

## Not proven yet

Everything built: prefactors, the move, the pinned-output rewrite, docs, QA.

## Notes

- Person decided (refine): no compatibility with `<repo>-worktrees/`; repo moves and doctor's adoption advice out of scope; worktrees in the per-checkout machine dir, not a shared `~/.norn/worktrees/`.
- Person agreed (plan): the two seams and the coverage table; prefactors (one `worktreesDir(root)` in store + `Facts.repo.worktrees`, returning the old folder at first so golden decisions don't change; the harness helper `h.worktree(<dir name>)` replacing ~80 hand-written `${h.root}-worktrees/…` paths); the harness check at cleanup that no `<repo>-worktrees` folder exists; the golden corpus rewritten mechanically to the new paths, with `bun run golden -- --update` showing zero decision changes.
- The transcript harness watches `<root>-worktrees` for runs files (test/support/transcript.ts `watchClone`); it moves to the helper too.

## Resume

Slice the plan (norn-slice): prefactors first.
