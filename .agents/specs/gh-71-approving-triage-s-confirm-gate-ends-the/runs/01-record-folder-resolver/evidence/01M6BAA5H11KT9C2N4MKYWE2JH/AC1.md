# AC1 — existing tiers pass, no test changed, pinned outputs unchanged
- Unit tier `bun run test`: 987 pass, 0 fail (unit.log). Typecheck: exit 0 (typecheck.log).
- Integration tier `bun run test:integration` (12x parallel): 510 pass, 1 fail (integration.log): check-run.test.ts:146 "two long checks (K1, K3)" saw an extra `run_check` (the gh-10 check had finished under load, so the tick started it again). Timing-sensitive; unrelated to record paths. Rerun of that file alone 3x: 5/5 pass each time (AC1-check-run-rerun.txt).
- E2E tier `bun run test:e2e`: 72 pass, 0 fail (e2e.log). That covers effect transcripts (slice-workflow, base-sync, recovery), observe snapshots and pinned outputs.
- No test changed: `git diff --numstat base...HEAD -- test packages/*/test` = only `32 0 test/repo/repo.test.ts` (pure additions: the AC2 pin). Golden corpus, transcripts, observe snapshots, brief snapshot: not in the diff (AC1-changed-tests.txt).
