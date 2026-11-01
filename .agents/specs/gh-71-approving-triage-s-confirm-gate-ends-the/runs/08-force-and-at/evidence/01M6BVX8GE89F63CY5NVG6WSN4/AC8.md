# AC8

Verifier: test. Test: `packages/cli/test/integration/human.test.ts:977` — "refusedUnchanged helper (AC8), used by AC3/AC4/AC5/AC6/AC7 tests".
Run: `bun test --config=bunfig.integration.toml packages/cli/test/integration/human.test.ts packages/cli/test/integration/run-rerun-cancel.test.ts` → 58 pass, 0 fail (tests.txt).

Each refusal: exit 3, CliError {code, error, do_instead}, recordSnapshot (every file under runs/ + branch head) equal before/after. By hand: AC9.md steps 1 and 3 print 'record+head unchanged: yes'.
