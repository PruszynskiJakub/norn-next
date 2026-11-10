## Goal

The `ci` check notices a PR that conflicts with its base before it waits for a CI run, and sends the story to `update` (counted on `stale_loop`), not to `implement` on `ci_loop`.

## Proof

- A check step may declare `exits: { <code>: <outcome> }`; validation refuses a check outcome that is neither pass, fail nor named by `exits`, an exit naming an undeclared outcome, and one naming pass/fail/exhausted. Tests: `packages/core/test/unit/workflow.test.ts` › "a check declares extra outcomes by exit code…"; `packages/schema/test/unit/workflow.test.ts` › "a check may declare outcomes by exit code beside pass and fail" and the exit-code rejects.
- Exit → outcome mapping (`checkOutcome` in `@norn/core`): `packages/core/test/unit/workflow.test.ts` › "checkOutcome: … exit 0 passes; a declared exit code names its outcome; anything else, a timeout included, fails".
- decide passes the step's `exits` on `run_check`: `packages/core/test/unit/decide.test.ts` › "a check carries the exit codes its step declares…".
- check-run records the named outcome (with the log): `packages/cli/test/integration/check-run.test.ts` › "a check-run whose step declares outcomes by exit code".
- apply routes a `stale` check receipt over its own counted edge: `packages/core/test/unit/apply.test.ts` › "check outcomes declared by exit code".
- ci scripts (repo story/quick/release, shipped story/quick): CONFLICTING → exit 3 with no run wait; UNKNOWN asked again up to 6×5s and never a conflict; a 5m timeout re-reads mergeable (exit 3 if it came to conflict) and names the state in its message. Tests: `packages/cli/test/integration/ci-check.test.ts` (new conflicting / UNKNOWN / timeout cases for both scripts).
- `bun run test` (1741 pass) and `bun run typecheck` green; the two integration files above run locally green (22 pass).

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

## Resume

Nothing left in implement; next is the workflow's update/test/review.
