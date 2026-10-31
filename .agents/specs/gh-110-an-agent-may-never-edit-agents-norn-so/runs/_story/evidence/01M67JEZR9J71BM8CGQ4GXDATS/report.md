| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| B1 | pass | B1-B2-init.txt, B1-config.txt |  |
| B2 | pass | B1-B2-init.txt, B2-quick-pinned.txt |  |
| B3 | pass | B3-B22-docs.txt |  |
| B4 | pass | B4-pinning.txt |  |
| B5 | pass | B5-tick-machine-dir.txt |  |
| B6 | pass | B6-user-config.txt |  |
| B7 | pass | B7-doctor-broken-workflow.txt |  |
| B8 | pass | B8-doctor-broken-config.txt |  |
| B9 | pass | B9-B10-doctor-repo-valid.txt, B9-doctor-full.txt |  |
| B10 | pass | B9-B10-doctor-repo-valid.txt, B7-doctor-broken-workflow.txt |  |
| B11 | pass | B11-B12-B13-migrate.txt |  |
| B12 | pass | B12-heartbeat-carried.txt |  |
| B13 | pass | B11-B12-B13-migrate.txt |  |
| B14 | pass | B14-migrate-rerun.txt |  |
| B15 | pass | B15-migrate-lock-held.txt |  |
| B16 | pass | B16-migrate-in-worktree.txt |  |
| B17 | pass | B17-both-layouts.txt |  |
| B18 | pass | B18-B19-B20-old-layout.txt |  |
| B19 | pass | B18-B19-B20-old-layout.txt |  |
| B20 | pass | B18-B19-B20-old-layout.txt |  |
| B21 | pass | B21-worktree-old-files.txt |  |
| B22 | pass | B3-B22-docs.txt, help output in report.md | AGENTS/CONTRIBUTING process lines old on purpose (D12) |
| B23 | person | The PR body is written later, in the story's `describe` step (pr.md in the spec folder). At the `ready` gate, check that the PR description has a 'Release note' paragraph saying that after `norn migrate` an older norn cannot read the repository and must be upgraded on every machine (D13, slice 07 AC4). README.md:115 already says the same. | PR body written in describe; check at ready |

Setup: dev build `bun packages/cli/src/main.ts` against throwaway repos under $TMPDIR/qa-gh110 cloned from a bare remote, with NORN_HOME_DIR=$TMPDIR/qa-gh110/home. Stories came from a scripted `gh` on PATH (two, then three issues assigned to `qa`); B15's live lock was taken with store's `acquireLock` at the old tick-lock path, the way a running `watch` holds it.

`norn help` (B22): `norn migrate  Move this repo's config, workflows and trace from the old layout to the new one and stage the moves for you to commit`.

Observation (not a criterion): a heartbeat.json whose heartbeat_id is not a valid ULID was silently replaced by the next tick, not reported as corrupt (S2). This was seen in a hand-made fixture; existing heartbeat behaviour, not part of this story.
bun test: 1528 pass, 0 fail (97 files); typecheck exit 0
