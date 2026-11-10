## Goal
norn creates and finds every story and slice worktree in `<machine dir>/worktrees/`, never in `<repo>-worktrees/` beside the repo; the docs say so.

## Proof
- The move: `packages/store/src/paths.ts` `worktreesDir(root) = join(machineDir(root), "worktrees")`; every user (observe, view, story-start, agent-unit, checkout, local-facts, scanWorktrees) goes through it. `grep -rn -- "-worktrees" packages/*/src docs` → empty.
- Review #1: `bun run test` 1734 pass, `bun run typecheck` clean (re-run by the reviewer). Golden: "0 of 136 golden case(s) decide differently now" (implement's run); pinned outputs differ only in worktree paths.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | the story worktree is created at `<machine dir>/worktrees/<story>-<slug>` on the story's branch | test | `packages/cli/test/integration/worktrees-machine-dir.test.ts` › "the tick creates the story worktree at <machine dir>/worktrees/<story>-<slug> on the story's branch…" |
| AC2 | a slice's worktree is at `<machine dir>/worktrees/<story>-<slug>--<nn>-<slug>`, beside the story's | test | `packages/cli/test/integration/worktrees-machine-dir.test.ts` › "the slice starts at <machine dir>/worktrees/<story>-<slug>--<nn>-<slug>, beside its story's…" |
| AC3 | no `<repo>-worktrees` folder exists when the harness cleans up | test | `test/support/harness.ts` `cleanup()` throws on any `*-worktrees` folder in the harness dir (runs in every harness test) |
| AC4 | with a home bound by `--home` or `NORN_HOME_DIR`, the worktree sits under that home's machine dir | test | `packages/cli/test/integration/worktrees-machine-dir.test.ts` › "the tick creates the story worktree…under the bound home" (NORN_HOME_DIR) and › "a home given to the command (the `--home` override, no NORN_HOME_DIR) holds the worktree" |
| AC5 | two clones of one remote each put the story's worktree in their own machine dir, at different paths | test | `packages/cli/test/integration/worktrees-machine-dir.test.ts` › "two clones of one remote take in the same story: each worktree is in its own clone's machine dir" |
| AC6 | `story start`, `--print`, the inbox's start command, the brief and the Herdr tab's cwd show the worktree in the machine dir | test | `packages/cli/test/integration/worktrees-machine-dir.test.ts` › "the inbox's start command, story start, --print and the Herdr tab's cwd show the worktree in the machine dir" and › "the brief run from the worktree in the machine dir starts the run there" (asserts the started receipt's `worktree`) |
| AC7 | `norn tidy` reports a clean and a dirty orphan in the machine dir's `worktrees/` and removes only the clean one | test | `packages/cli/test/integration/worktrees-machine-dir.test.ts` › "a clean and a dirty orphan are both reported; tidy removes only the clean one" |
| AC8 | a worktree deleted from the machine dir's `worktrees/` is noticed and recreated by `story start` | test | `packages/cli/test/integration/worktrees-machine-dir.test.ts` › "a story worktree deleted from the machine dir's worktrees/: story start notices and recreates it" |
| AC9 | `norn status --json` shows each running story and slice unit's worktree in the machine dir | test | `packages/cli/test/integration/worktrees-machine-dir.test.ts` › "norn status shows the running story's worktree in the machine dir" and › "the slice starts at…; status shows it" (inbox `reach.worktree`) |
| AC10 | the golden replay with worktree paths rewritten to the machine dir changes no decision | test | the golden replay in `bun run test` (136 cases rewritten, 0 decide differently) |
| AC11 | the concepts page's run state paragraph and glossary say worktrees live in the machine dir's `worktrees/`; no doc mentions `<repo>-worktrees` | agent | QA (agent) — `docs/concepts.md` run state paragraph and `worktree` glossary row read in review; grep of `docs/` for `-worktrees` empty |

## Easy to miss
- `worktreeOf`/`worktreesOf` in tests now need the clone's norn home bound (`bindNornHome`) first. Without it they fall back to the default home. Fixed in `test/e2e/recovery.test.ts` and `test/e2e/team.test.ts` (their own `cloneOf`), `human.test.ts` (twin and colleague clones), and `packages/view/test/integration/view.test.ts` (two tests now bind a home and pass it to `loadProjectView`).
- A unit worktree is now inside the home. `checkoutOf` walking up from it still resolves to the main checkout through the worktree's `.git` file.

## Not proven yet
- The new integration file `packages/cli/test/integration/worktrees-machine-dir.test.ts` and the edited integration/e2e tests (`view.test.ts`, `human.test.ts`, `team.test.ts`) were **not run locally**: the brief keeps the integration tier for CI. Only the e2e files with pinned outputs were run, to rewrite them (all passed). If CI fails there, the likely weak points are the flow assumptions in the new file: the inbox item shape for a running unit (`reach.worktree`) and the clone C intake in the `home`-dep test.
- macOS path spelling (`/var` vs `/private/var`): the orphan check compares `git worktree list` paths against `worktreesDir(root)` with `startsWith`. A home reached through a symlink could make them differ. The tests use realpath'd temp dirs, and the default `~/.norn` has no symlink, so this is unverified for a symlinked `NORN_HOME_DIR`.

## Notes
- Review #1: the integration tests count as proof only once CI runs them green; the reviewer read them and saw them assert each criterion, but did not run them (the integration tier is CI's).
- Out of scope, but noted: doctor's adoption advice for an orphaned machine dir (`rm -rf <mine> && mv <old> <mine>`) would now also delete the current checkout's `worktrees/`. The spec rules doctor's advice out of this story; it is worth a follow-up issue.
- Unit-test fixtures in core, adapters and cockpit still use arbitrary `/r-worktrees/…` paths as inputs to pure functions. They are not paths norn makes and were left as they are.
- Friction: the Bash hook refuses any `git worktree add`, including in a scratch repo under /tmp. So the macOS spelling risk could not be probed by hand.

## Resume
Review #1 approved with no blocking findings (3 minor notes: the doctor adoption advice, the symlinked-home orphan check, and the brief proof via the started receipt). Next: QA. Its first job is to confirm that CI's integration tier passes `packages/cli/test/integration/worktrees-machine-dir.test.ts`, then give AC11 (docs) its agent verdict.
