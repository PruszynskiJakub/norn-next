# QA gh-110/06 norn migrate

Full suite: 1473 pass, 0 fail (suite.txt); typecheck green; migrate.test.ts 13 pass.
Hands-on with the dev build (`bun packages/cli/src/main.ts`) in throwaway repos under $TMPDIR, NORN_HOME_DIR in $TMPDIR. Old layout made by hand from a ticked repo (repo) and by the released norn 0.12.1's own ticks on clones (repo2–5).

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B11) | pass | AC1-AC3-migrate.txt, AC1-json.txt | |
| AC2 (B12) | pass | AC1-AC3-migrate.txt, AC9-after.txt, migrate-tests.txt | claim recognition via test (no remote issues by hand) |
| AC3 (B13) | pass | AC1-AC3-migrate.txt | |
| AC4 (B14) | pass | AC4.txt | |
| AC5 (B15) | pass | AC5.txt | a stale lock left by the killed holder was taken over by the next migrate |
| AC6 (B16) | pass | AC6.txt | linked worktree by hand; unit worktree by test |
| AC7 (B17) | pass | AC7.txt | |
| AC8 (B11, B12) | pass | AC8-interrupted.txt, AC8-untracked.txt | |
| AC9 | pass | AC1-AC3-migrate.txt, AC4.txt, AC9-after.txt | |

Edge (not an AC): a run cut short partway through the workflow files (edge-mid-workflows.txt) is refused both_layouts, and its do_instead "keep one of each pair and remove the other" would lose the files still at the old place if followed literally.
