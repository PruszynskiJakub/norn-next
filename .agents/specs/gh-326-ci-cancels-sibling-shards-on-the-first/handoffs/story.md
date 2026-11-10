# gh-326 handoff

## Goal
One red CI run reports every failing shard, and the ci check's rework brief never takes a cancelled or skipped job for a pass.

## Proof
- `fail-fast: false` on the integration and e2e matrices (`.github/workflows/ci.yml`): `test/repo/repo.test.ts` › "AC5 (B11, B12): ci.yml runs unit and the type check first; 4 integration shards and 3 e2e shards, none with fail-fast …" (went red before the change).
- `.agents/scripts/ci-failures.sh` lists cancelled and skipped jobs, marked "(<conclusion>: unknown, not run to the end)": `packages/cli/test/integration/ci-check.test.ts` › "fails on a red run with where its failures are, never its log". Its fake gh now applies the script's own `-q` filter with `jq` to a jobs fixture (failure, cancelled, success, skipped), so the filter itself is tested.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| Wanted 1 | one CI run reports every failing shard: `fail-fast: false` on the integration and e2e matrices | test | `test/repo/repo.test.ts` › "AC5 (B11, B12): ci.yml runs unit and the type check first; 4 integration shards and 3 e2e shards, none with fail-fast …" (asserts `failFast: false` on both) |
| Wanted 2 | `ci-failures.sh` also lists cancelled or skipped jobs, marked "unknown, not run to the end" | test | `packages/cli/test/integration/ci-check.test.ts` › "fails on a red run with where its failures are, never its log" (asserts the exact `- job` lines for failure, cancelled and skipped; leaves out the jobs that passed) |

## Easy to miss
- The fake gh's `shift 6` assumes the call shape `gh run view <run> --json jobs -q <expr>`; change both together.
- The integration test needs `jq` on PATH (present on ubuntu-latest and macOS here).

## Not proven yet
- The integration test runs only in CI (integration tier). The filter was checked locally by running jq with it against a fixture: failure and cancelled lines came out as expected.

## Notes
- A skipped job is listed too (e.g. `package` after a red `unit`): it also never ran to the end.
- Review #1: approved. The one minor note: other non-success conclusions (`timed_out`, `startup_failure`) are still left out of ci-failures.sh. The spec names only cancelled and skipped.
- `bun install` was needed in this worktree before `bun run test` / typecheck would run.

## Resume
pr.md (in the spec folder) describes the branch as it is now; next is norn's PR step. Nothing left to build.
