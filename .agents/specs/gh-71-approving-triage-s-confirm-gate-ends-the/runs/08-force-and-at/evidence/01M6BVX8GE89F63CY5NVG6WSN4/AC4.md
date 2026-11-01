# AC4

Verifier: test. Test: `packages/cli/test/integration/human.test.ts:544` — "gh-71 B13 (AC4, AC8): --force is refused while a slice is unfinished; integrated slices don't block it".
Run: `bun test --config=bunfig.integration.toml packages/cli/test/integration/human.test.ts packages/cli/test/integration/run-rerun-cancel.test.ts` → 58 pass, 0 fail (tests.txt).

Slice at implement → refused exit 3 naming the slice, nothing changed; with only integrated/dropped slices the edit succeeds.
