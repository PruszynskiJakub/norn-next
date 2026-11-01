# AC2

Verifier: test. Test: `packages/cli/test/integration/human.test.ts:1009` — "B11 (AC2): a $stuck round 1 ended with --force --at starts round 2 at that step".
Run: `bun test --config=bunfig.integration.toml packages/cli/test/integration/human.test.ts packages/cli/test/integration/run-rerun-cancel.test.ts` → 58 pass, 0 fail (tests.txt).

Test fixture uses --at ready (its quick workflow); observed by hand with the real quick workflow and --at sync in AC2-handson.md: round 2 quick at sync, round 1 ended by the person at explore.
