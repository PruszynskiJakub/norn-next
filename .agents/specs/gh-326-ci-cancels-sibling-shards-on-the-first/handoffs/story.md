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
- Nothing open. CI run 42842498215 (commit 5db02efef, same repo files as the current head) passed all 9 jobs, the integration shard holding ci-check.test.ts among them.

## Notes
- A skipped job is listed too (e.g. `package` after a red `unit`): it also never ran to the end.
- Review #1: approved. The one minor note: other non-success conclusions (`timed_out`, `startup_failure`) are still left out of ci-failures.sh. The spec names only cancelled and skipped.
- ci#1 `fail` was not this change: the check looked up a ci.yml run for 615d222df (the PR head when it ran), but norn pushed its state commit 5db02efef straight after, and GitHub made the `pull_request` CI run only for 5db02efef (green). implement#2 changed no code; the repo files are identical across 615d222df, 5db02efef and 317577eeb.
- Friction: the ci check reads `headRefOid` once, and norn's own state-commit push can race it; a re-read of the head inside the retry loop would avoid this. Left out on purpose (outside this story).
- `bun install` was needed in this worktree before `bun run test` / typecheck would run.

## Resume
Nothing to build. The next ci check should find the CI run for the new head; pr.md still describes the branch as it is.
