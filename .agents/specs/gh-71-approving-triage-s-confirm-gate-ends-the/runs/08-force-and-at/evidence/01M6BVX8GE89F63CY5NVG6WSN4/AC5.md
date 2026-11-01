# AC5

Verifier: test. Test: `packages/cli/test/integration/human.test.ts:1096` — "B14 (AC5): --force on a finished round is the same edit as without it".
Run: `bun test --config=bunfig.integration.toml packages/cli/test/integration/human.test.ts packages/cli/test/integration/run-rerun-cancel.test.ts` → 58 pass, 0 fail (tests.txt).

Receipt forced:false, new round 03-quick at work, finished round has no ended. Unknown workflow half: 1021 'B17 (AC5, AC8)' → unknown_workflow, do_instead lists workflows, unfinished round untouched (snapshot equal).
