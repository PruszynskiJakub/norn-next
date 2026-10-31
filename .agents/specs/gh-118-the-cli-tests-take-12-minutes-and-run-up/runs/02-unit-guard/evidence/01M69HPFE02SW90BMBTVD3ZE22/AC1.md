# AC1
Ran `bun test --preload <worktree>/test/support/unit-guard-preload.ts ./guard-qa.test.ts` on a throwaway test file (scratchpad/qa/t) that calls Bun.spawn, Bun.spawnSync and node child_process.spawn with `git rev-parse HEAD`.
Each call threw at the call site (stack points at `throw new Error` in block / at the spawn line), message:
`unit test in <path>/guard-qa.test.ts started \`git rev-parse HEAD\`; a test that spawns belongs in test/integration/`
All three tests: (fail). Full log: AC1-3-run.txt. Self-test test/repo/unit-guard.test.ts: 8 pass (self-test.txt).
