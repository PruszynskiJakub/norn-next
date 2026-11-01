# AC1 (B4, B1) — pass
- `bunfig.toml` [test] preload = ["./test/preload.ts", "./test/support/unit-guard-preload.ts"]; pathIgnorePatterns ["**/integration/**", "test/e2e/**"].
- `bunfig.integration.toml` and `bunfig.e2e.toml` preload ["./test/preload.ts", "./test/support/spawning-tier-preload.ts"]: they do not name the unit guard.
- `bun run test` (= `bun test`) with the guard on: 983 pass, 0 fail, 55 files, 1.89–1.94 s (AC7-unit-{1,2,3}.log).
- Proof the guard is live under `bun test`: AC3.log (a spawn fails).
- Caveat (implement handoff): under `--parallel`, bun 1.3.13 workers also load the root bunfig's preloads, so the guard module does load in integration/e2e workers. spawning-tier-preload.ts calls allowSpawns() to switch it off. The configs as declared meet AC1, and both spawning tiers pass three times (AC7).
