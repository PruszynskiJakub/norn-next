# AC2 (B5, B6)
Scripts: test:integration = `bun test --config=bunfig.integration.toml --parallel --timeout=20000`; test:e2e = `bun test --config=bunfig.e2e.toml --parallel --timeout=20000`.
bunfig.integration.toml root=packages, ignores packages/*/test/*.ts and every test subfolder but integration/; bunfig.e2e.toml root=test/e2e.
Runs: integration 372 tests (all files under packages/cli/test/integration), e2e 72 tests (test/e2e) — AC8-summary.txt.
Passthrough: `bun run test:e2e test/e2e/base-sync.test.ts` ran 1 file, 12 tests (AC7-run.log).
Repo rules B5/B6 for both tiers pass (AC1-4-rules.txt).
