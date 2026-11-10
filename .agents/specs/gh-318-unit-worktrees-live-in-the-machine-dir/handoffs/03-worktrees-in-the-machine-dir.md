## Goal
norn creates and finds every story and slice worktree in `<machine dir>/worktrees/`, never in `<repo>-worktrees/` beside the repo; the docs say so.

## Proof
- The move: `packages/store/src/paths.ts` `worktreesDir(root) = join(machineDir(root), "worktrees")`. `test/support/worktree.ts` now delegates to it. `grep -rn -- "-worktrees" packages/*/src` → empty.
- Red first at a unit seam: `packages/store/test/unit/worktree.test.ts` › "scanWorktrees … story and slice worktrees by folder shape and marker" now asserts `worktreesDir(root) === join(machineDir(root), "worktrees")`. It failed on the old folder.
- AC1 (story worktree created at `<machine dir>/worktrees/<story>-<slug>` on its branch), AC3 (no `<repo>-worktrees`), AC4 (NORN_HOME_DIR home): `packages/cli/test/integration/worktrees-machine-dir.test.ts` › "the tick creates the story worktree at <machine dir>/worktrees/…".
- AC2 (slice worktree beside the story's, on its branch) and AC9 (status shows the slice's worktree): same file › "the slice starts at <machine dir>/worktrees/<story>-<slug>--<nn>-<slug>…". AC9 for the story: › "norn status shows the running story's worktree in the machine dir".
- AC3 for every test (D4): the harness `cleanup()` throws when any `*-worktrees` folder exists in the harness dir (`test/support/harness.ts`).
- AC4 (`home` dep, the `--home` override): › "a home given to the command (the `--home` override, no NORN_HOME_DIR) holds the worktree".
- AC5 (two clones get different paths): › "two clones of one remote take in the same story…".
- AC6 (start command, `--print`, Herdr tab cwd, brief): › "the inbox's start command, story start, --print and the Herdr tab's cwd…" and › "the brief run from the worktree in the machine dir starts the run there".
- AC7 (clean orphan removed, dirty one kept): › "a clean and a dirty orphan are both reported; tidy removes only the clean one".
- AC8 (gone-check after `rm -rf`): › "a story worktree deleted from the machine dir's worktrees/: story start notices and recreates it".
- AC10 (golden replay unchanged): the 136 cases were rewritten by script from `<dir>/repo-worktrees` to `<dir>/home/repos/<id>/worktrees` (each case keeps its own id, or gets a stable one) and renamed by `caseName`. `bun run golden -- --update` → "0 of 136 golden case(s) decide differently now".
- Pinned outputs (D5): observe snapshots and the 3 e2e transcripts were rewritten with `NORN_TRANSCRIPT_UPDATE=1 bun run test:e2e <file>`. A paired diff of old and new lines shows they differ only in worktree paths.
- AC11 (docs): `docs/concepts.md` run state paragraph and glossary `worktree` row. No doc mentions `-worktrees`, apart from CHANGELOG history, which is not to be edited.
- `bun run test`: 1734 pass. `bun run typecheck`: clean.

## Easy to miss
- `worktreeOf`/`worktreesOf` in tests now need the clone's norn home bound (`bindNornHome`) first. Without it they fall back to the default home. Fixed in `test/e2e/recovery.test.ts` and `test/e2e/team.test.ts` (their own `cloneOf`), `human.test.ts` (twin and colleague clones), and `packages/view/test/integration/view.test.ts` (two tests now bind a home and pass it to `loadProjectView`).
- A unit worktree is now inside the home. `checkoutOf` walking up from it still resolves to the main checkout through the worktree's `.git` file.

## Not proven yet
- The new integration file `packages/cli/test/integration/worktrees-machine-dir.test.ts` and the edited integration/e2e tests (`view.test.ts`, `human.test.ts`, `team.test.ts`) were **not run locally**: the brief keeps the integration tier for CI. Only the e2e files with pinned outputs were run, to rewrite them (all passed). If CI fails there, the likely weak points are the flow assumptions in the new file: the inbox item shape for a running unit (`reach.worktree`) and the clone C intake in the `home`-dep test.
- macOS path spelling (`/var` vs `/private/var`): the orphan check compares `git worktree list` paths against `worktreesDir(root)` with `startsWith`. A home reached through a symlink could make them differ. The tests use realpath'd temp dirs, and the default `~/.norn` has no symlink, so this is unverified for a symlinked `NORN_HOME_DIR`.

## Notes
- Out of scope, but noted: doctor's adoption advice for an orphaned machine dir (`rm -rf <mine> && mv <old> <mine>`) would now also delete the current checkout's `worktrees/`. The spec rules doctor's advice out of this story; it is worth a follow-up issue.
- Unit-test fixtures in core, adapters and cockpit still use arbitrary `/r-worktrees/…` paths as inputs to pure functions. They are not paths norn makes and were left as they are.
- Friction: the Bash hook refuses any `git worktree add`, including in a scratch repo under /tmp. So the macOS spelling risk could not be probed by hand.

## Resume
Review the two commits on this branch (`store: unit worktrees live in the machine dir's worktrees/…` and `test: worktrees in the machine dir…`). CI's integration tier is the first real run of `worktrees-machine-dir.test.ts`.
