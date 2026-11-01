# AC1

Verifier: test. Test: `packages/cli/test/integration/human.test.ts:1047` — "B11, B32 (AC1): --force at confirm ends round 1 by the person and starts round 2 at refine".
Run: `bun test --config=bunfig.integration.toml packages/cli/test/integration/human.test.ts packages/cli/test/integration/run-rerun-cancel.test.ts` → 58 pass, 0 fail (tests.txt).

Asserts receipt forced:true, left_at confirm; round 1 state $done/done with ended {by: person, at: confirm, receipt_id}; round 2 story at refine. Also 1029: a forced receipt rejected for a changed workflow keeps the confirm gate park. Observed the same by hand in AC9.md (step 2).
