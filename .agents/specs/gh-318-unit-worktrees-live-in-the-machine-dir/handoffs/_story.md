# gh-318 — handoff

## Goal

Unit worktrees are created in the checkout's machine dir (`<machine dir>/worktrees/<story>-<slug>[--<nn>-<slug>]`), never in `<repo>-worktrees/`.

## Proof

Sliced, nothing built yet. Three slices in `slices/`; every user story is covered by an acceptance criterion, and all criteria are listed in spec.md's frontmatter `criteria` (prefixed `01.`, `02.`, `03.`).
- 01 One place names the worktrees folder (no deps): store's `worktreesDir(root)` and `Facts.repo.worktrees`, every caller routed through them, still the old folder. Proven by decide tests through Facts (S2) and the golden replay unchanged.
- 02 Tests name worktrees through the harness (no deps): `h.worktree(<dir name>)` replaces hand-spelled `${h.root}-worktrees/…` in integration/e2e tests and the transcript's watched clone.
- 03 Worktrees move into the machine dir (depends on 01, 02): the move, the harness cleanup check that no `<repo>-worktrees` exists, integration tests for every user story (S1), pinned outputs rewritten as paths only, docs.

## Easy to miss

- Core is pure: the folder reaches decide as `Facts.repo.worktrees`, never by calling the machine dir from core.
- Every place that builds or recognises the old path must move: decide (intake, slice start), `loadLocalFacts`, the story checkout, `unitStoryMode` (agent-unit), observe's orphan check, `inferUnitMarker`, `scanWorktrees`, `story start`'s gone-check. A grep for `-worktrees` in `packages/*/src` must come back empty after slice 03.
- macOS `/var` vs `/private/var`: the worktree path now sits under the home; check comparisons against `git worktree list`.
- `bun run golden` without flags harvests from the integration tier (not a local check); the replay runs inside `bun run test`, and `bun run golden -- --update` must print no changed case.

## Not proven yet

Everything built: both prefactors, the move, the pinned-output rewrite, docs, QA.

## Notes

- Person decided (refine): no compatibility with `<repo>-worktrees/`; repo moves and doctor's adoption advice out of scope; worktrees in the per-checkout machine dir, not a shared `~/.norn/worktrees/`.
- Person agreed (plan): seams S1 (cli integration harness) and S2 (decide through Facts), prefactors first, harness check at cleanup (D4), golden corpus rewritten mechanically (D5).
- Slicing: the plan still holds on this base: the old path is built in exactly the places the plan lists. Slices 01 and 02 run in parallel; critical path is two levels (01 or 02 → 03). Slice 02's helper computes the old folder itself so it need not wait for 01; slice 03 points it at `worktreesDir`.
- Slice 03 is the largest; kept whole because the move and recognition must change together to stay green. Its Notes name the fallback split (the tests for home, clones, tidy, gone-check and view into a follow-up slice) if it outgrows one context.
- Slice 01 adds a field to observe's output, so observe snapshots change by that field only.

## Resume

Person approves the slices at the gate; then slices 01 and 02 start in parallel, slice 03 after both land.
