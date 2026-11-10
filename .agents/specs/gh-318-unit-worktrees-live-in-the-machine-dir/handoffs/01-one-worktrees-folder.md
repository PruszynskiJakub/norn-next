## Goal
One store function (`worktreesDir(root)` in `packages/store/src/paths.ts`) names the unit worktrees folder; decide reads it from `Facts.repo.worktrees`. The folder is still `<repo>-worktrees`, so nothing a person sees changes.

## Proof
- Decide takes worktree paths from the fact (AC1): `packages/core/test/unit/decide.test.ts` › "worktree paths come from the worktrees folder observe reports" (intake: story worktree path and commit cwd; slice start with no story worktree on disk: slice path, commit cwd, `startAgentCommand`). Both tests failed with decide still deriving from `repo.root`.
- Golden replay unchanged (AC2): all 136 cases got `facts.repo.worktrees = "<dir>/repo-worktrees"` and were renamed to their new stable key (name = hash of decide's inputs); `golden.test` replays every case with no decision change.
- No hand-built `-worktrees` path left (AC3): `grep -rn -- "-worktrees" packages/*/src` → only `worktreesDir` in store paths. Routed through it: decide intake + slice start (via the fact), observe (fills the fact, orphan check), view `load.ts` (fills the fact), `loadLocalFacts`, `restoreWorktrees` in checkout, `unitStoryMode`, `inferUnitMarker`, `scanWorktrees`, `story start`'s gone-check.
- `bun run test` (1734 pass) and `bun run typecheck` green.

## Easy to miss
- `storyWorktreePath` in core now takes the worktrees folder, not the repo root.
- Observe snapshots (`test/e2e/observe-snapshots/*.json`) were rewritten with `NORN_TRANSCRIPT_UPDATE=1 bun run test:e2e test/e2e/observe-snapshots.test.ts`; the diff is the new `worktrees` field only.

## Not proven yet
- Integration and e2e tiers (CI runs them).

## Notes
- Golden rewrite was a one-off script (add the field, rename by `caseName(source, caseBody(c))`); slice 03 moves the folder and rewrites the corpus paths (D5).

## Resume
Slice done; review next. Slice 03 changes `worktreesDir` to `join(machineDir(root), "worktrees")`.
