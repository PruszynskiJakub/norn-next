## Goal

The `ci` check notices a PR that conflicts with its base before it waits for a CI run, and sends the story to `update` (counted on `stale_loop`), not to `implement` on `ci_loop`.

## Proof

Review #1 traceability (the spec has no frontmatter criteria; rows are its Wanted bullets and Decision):

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| Wanted: conflict | the ci check notices a CONFLICTING PR before waiting for a run, and the story goes to `update` without spending `ci_loop` or a 5m wait | test | `packages/cli/test/integration/ci-check.test.ts` › "exits 3 (stale) at once on a PR that conflicts with its base, waiting for no run" / "…waiting for no check" and "story runs the same script as quick, declaring exit 3 as stale → update" (both); `packages/core/test/unit/apply.test.ts` › "a check receipt with an exit-code outcome takes that outcome's edge, counted on its own counter"; `test/repo/repo.test.ts` › "quick and story wait for the PR's CI after open-pr, send a red run back to implement and a conflicting PR to update" |
| Wanted: UNKNOWN | UNKNOWN mergeability is retried briefly, never treated as a conflict | test | `ci-check.test.ts` › "asks again while mergeability is UNKNOWN, never taking it for a conflict" (both scripts) and "goes on to wait when mergeability stays UNKNOWN" |
| Wanted: timeout message | the "no run after 5m" message names the PR's mergeable state | test | `ci-check.test.ts` › the 5m timeout cases assert "(PR mergeable: MERGEABLE)"; "exits 3 (stale) when the PR came to conflict while no run appeared" |
| Decision: exits | a check may declare extra outcomes by exit code; plain pass/fail by exit 0/non-zero stays the default | test | `packages/core/test/unit/workflow.test.ts` › "a check declares extra outcomes by exit code…" and "checkOutcome: …"; `packages/schema/test/unit/workflow.test.ts` › "a check may declare outcomes by exit code beside pass and fail" + exit-code rejects; `packages/core/test/unit/decide.test.ts` › "a check carries the exit codes its step declares…"; `packages/cli/test/integration/check-run.test.ts` › "records the outcome its exit code names, with the log; other exits stay fail" |

- A check step may declare `exits: { <code>: <outcome> }`; validation refuses a check outcome that is neither pass, fail nor named by `exits`, an exit naming an undeclared outcome, and one naming pass/fail/exhausted. Tests: `packages/core/test/unit/workflow.test.ts` › "a check declares extra outcomes by exit code…"; `packages/schema/test/unit/workflow.test.ts` › "a check may declare outcomes by exit code beside pass and fail" and the exit-code rejects.
- Exit → outcome mapping (`checkOutcome` in `@norn/core`): `packages/core/test/unit/workflow.test.ts` › "checkOutcome: … exit 0 passes; a declared exit code names its outcome; anything else, a timeout included, fails".
- decide passes the step's `exits` on `run_check`: `packages/core/test/unit/decide.test.ts` › "a check carries the exit codes its step declares…".
- check-run records the named outcome (with the log): `packages/cli/test/integration/check-run.test.ts` › "a check-run whose step declares outcomes by exit code".
- apply routes a `stale` check receipt over its own counted edge: `packages/core/test/unit/apply.test.ts` › "check outcomes declared by exit code".
- ci scripts (repo story/quick/release, shipped story/quick): CONFLICTING → exit 3 with no run wait; UNKNOWN asked again up to 6×5s and never a conflict; a 5m timeout re-reads mergeable (exit 3 if it came to conflict) and names the state in its message. Tests: `packages/cli/test/integration/ci-check.test.ts` (new conflicting / UNKNOWN / timeout cases for both scripts).
- Review #1 re-ran: `bun run test` 1755 pass, `bun run typecheck` green, the two integration files 22 pass.

## Easy to miss

- Plain checks keep pass (exit 0) / fail (any other); a timeout is always fail even if `exits` exists.
- `exits` lands on the action/order only when declared, so goldens and transcripts of existing workflows do not change.
- The shipped ci passes when no checks appear after 5m (repo with no CI); a conflicting PR now exits 3 there instead of passing.
- The repo test requires quick, story and release to share one ci script, so `release.yaml` got the same script and `stale → update` route.

## Not proven yet

- No live GitHub run of the new script; the behaviour is proven against a fake `gh` only.

## Notes

- Decision: the receipt carries the real outcome (`stale`), so history, brief and `last_check` treat it as not a failing check (no rework shown to implement). `CheckReceipt.outcome` widened to `OutcomeName`; `CheckOrder` gained optional `exits`.
- Check outcomes are now an open map in the schema; the pass/fail/exits rule moved to load-time validation (`unknown_outcome`).
- Schema JSON emitted; `docs:emit` produced no change; concepts glossary and the "Write your own workflow" recipe mention `exits`.
- Review #1 approved with no blocking findings. Note for the person: seven harvested golden cases (`packages/core/test/golden/{human,merged-pr,pr-body,runtime}-*.json`) appeared untracked at 16:21:43, after the test check, not from this change; norn's report commit sweeps them into the branch. Drop them before merge if unwanted.
- describe#1 wrote pr.md. It calls the change one-way, because once a `stale` check receipt exists the old schema refuses it, and it tells the person to drop the seven harvested golden cases.
- sync-resolve#1 merged main (7780accfd2f9, which brings the CI change where one failing shard no longer cancels the others) into the branch. The only conflict was in `ci-check.test.ts`: main added a `JOBS` fixture and a jq-backed `gh run view --json jobs` fake, and this branch added the `mergeable` parameter to the repo-script `run` helper. The resolution keeps both. After the merge: `bun run test` 1755 pass, typecheck green, ci-check + story-reset integration 19 pass.
- Friction: something in the test step left harvested golden files untracked in the worktree, so they ride along in the next report commit.

## Resume

main is merged in (merge commit c80b03bbf). pr.md still describes the branch. Next: norn syncs again, then updates the draft PR and runs `ci`.
