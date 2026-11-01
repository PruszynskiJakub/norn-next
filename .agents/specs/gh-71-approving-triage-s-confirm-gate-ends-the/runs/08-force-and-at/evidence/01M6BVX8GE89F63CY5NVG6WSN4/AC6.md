# AC6

Verifier: test. Test: `packages/cli/test/integration/human.test.ts:1066` — "B15 (AC6, AC8): --at alone moves the same round's cursor, counters kept; an unknown step names the round's steps".
Run: `bun test --config=bunfig.integration.toml packages/cli/test/integration/human.test.ts packages/cli/test/integration/run-rerun-cancel.test.ts` → 58 pass, 0 fail (tests.txt).

Same round, workflow receipt with from_hash = to_hash, counters kept (fix 1 stays), no new round folder; --at nope → unknown_step naming the steps. Fixture uses refine/build instead of ready/implement (review nit). Line 120 now expects unknown_step for --at alone (no usage error). Observed by hand in AC9.md (steps 3, 4).
