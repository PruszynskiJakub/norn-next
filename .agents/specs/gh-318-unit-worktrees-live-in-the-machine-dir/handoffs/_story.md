# gh-318 — handoff

## Goal

Unit worktrees are created in the checkout's machine dir (`<machine dir>/worktrees/<story>-<slug>[--<nn>-<slug>]`), never in `<repo>-worktrees/`.

## Proof

Review #6 at b4d0b0ad: approve, no findings; review #5's blocking finding (e2e transcripts) is fixed, the only change since being the three one-line transcript deletions. Implement #6: review #5's blocking finding fixed. The three effect transcripts (`recovery-claim-lost.txt`, `base-sync.txt`, `e2e-slice-workflow.txt`) were rewritten; each diff drops only intake's local `git show-ref --verify --quiet refs/heads/<branch>` line, the intended effect of ci fix #5 (intake skips a story whose branch is on the remote whenever its worktree is gone, `act/lifecycle.ts:230`; observe skips prunable worktrees, `observe/index.ts:170`). Locally: e2e 76/76, unit 1739 pass, typecheck green. QA #5 at c892491c (before ci fix #5): 16/16 `pass`.

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
| 03.AC7 / story 7 | `tidy` reports a clean and a dirty orphan and removes only the clean one | test | `packages/cli/test/integration/worktrees-machine-dir.test.ts` › "a clean and a dirty orphan are both reported…" and "a home reached through a symlink…" |
| 03.AC8 / story 8 | `story start` notices a deleted story worktree and recreates it | test | `packages/cli/test/integration/worktrees-machine-dir.test.ts` › "a story worktree deleted from the machine dir's worktrees/…" |
| 03.AC9 / story 9 | `status --json` shows each unit's worktree in the machine dir | test | `packages/cli/test/integration/worktrees-machine-dir.test.ts` › "norn status shows the running story's worktree…" and the slice test (reach plus `story list` root); `packages/view/test/integration/view.test.ts` › "reads specs from story worktrees in the checkout's machine dir" |
| 03.AC10 | rewritten golden corpus: no decision change | test | `packages/core/test/unit/golden.test.ts` |
| 03.AC11 / story 10 | docs say worktrees live in the machine dir under `worktrees/` | agent | QA (agent); review read `docs/concepts.md` run-state paragraph and glossary |

Open minor: the decide fixture still reports `/r-worktrees`. Nit: `orphanedMachineDirs` (`machine-dir.ts:30`) compares a resolved own dir with an unresolved listing; harmless.

## Easy to miss

- Core is pure: the folder reaches decide as `Facts.repo.worktrees`, never by calling the machine dir from core.
- macOS `/var` vs `/private/var`: worktree paths sit under the home; compare against `git worktree list`. The machine dir is built on the resolved home for this reason; never build it from an unresolved home elsewhere.
- `git grep -- '-worktrees'` silently treats the pattern as a path: use `git grep -e '-worktrees' <rev> -- packages/` (a `packages/*/src` pathspec glob also missed nested files).

## Not proven yet

- The full integration and e2e tiers on CI after ci fix #5. The EFAULT cleanup flake fix (harness `removeTree`) is still unproven on CI.

## Notes

- e2e flake seen once under the parallel full tier: base-sync.test.ts › "base_branch: develop (7b)" failed, then passed alone and in a full rerun (76/76).
- Wiped machine dir (ci fix #5): a wiped home now takes the unit worktrees with it, leaving git a prunable registration and the local branch. Two product fixes: observe's `classifyWorktrees` skips a worktree whose folder is gone (else `restore_markers` recreates the path as a non-repo folder and intake's `git add` fails); intake skips a story whose branch is on the remote even when a local branch is left (it continues by `story checkout`, which prunes the stale registration). The B26 no-ref test now expects A's tick to emit only that skipped intake (no `claim.other`: unknown locally, as on a fresh clone) and no worktree; `checkout --force` still restarts implement with record_lost.
- `machine-dir.test.ts` skips the machine dir's `worktrees/` when collecting machine-local file names (it holds the repo's own files). A test that unbinds the home must not call `h.worktree`/`worktreesOf` afterwards. Run one integration file: `bun test --config=bunfig.integration.toml --timeout=20000 ./<path>`.
- Person decided (refine): no compatibility with `<repo>-worktrees/`; repo moves and doctor's adoption advice out of scope; worktrees in the per-checkout machine dir, not a shared `~/.norn/worktrees/`.
- Person agreed (plan): seams S1 (cli integration harness) and S2 (decide through Facts), prefactors first, harness check at cleanup (D4), golden corpus rewritten mechanically (D5).
- `machineHomeOf` resolves the home (one spelling for every machine-dir path), memoized only once the home exists.
- QA: `story start --print` on an agent step running in auto is refused (`nothing_to_open`); the person-facing paths were checked on an attended step in manual mode. There is no `--home` CLI flag: the spec's `--home` means the home given to the command (deps.home). Never run `bun run golden` without `--update` to check: it harvests by running the integration tests.

## Resume

Review #6 approved at b4d0b0ad (unit 1739 pass, e2e 76/76, typecheck green, re-run by review). Next: the test check, then QA re-observes the 16 criteria on this head (the intake and observe changes of ci fix #5 came after QA #5), then CI.
