# AC3 (B4) — pass
Throwaway packages/store/test/unit/qa-head.test.ts: test("reads the head") runs Bun.spawnSync(["git","rev-parse","HEAD"]).
`bun test packages/store/test/unit/qa-head.test.ts` → exit 1, and the output has
`error: unit test in packages/store/test/unit/qa-head.test.ts started \`git rev-parse HEAD\`; a test that spawns belongs in test/integration/`
`(fail) reads the head [0.50ms]`. Full output: AC3.log. The file was removed (it was in a separate copy of HEAD).
