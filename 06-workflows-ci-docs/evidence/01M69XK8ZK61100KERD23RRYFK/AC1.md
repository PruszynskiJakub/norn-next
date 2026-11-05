## AC1
$ jq .scripts package.json
{
  "test": "bun test",
  "test:integration": "bun test --config=bunfig.integration.toml --parallel --timeout=20000",
  "test:e2e": "bun test --config=bunfig.e2e.toml --parallel --timeout=20000",
  "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p scripts/tsconfig.json",
  "schema:emit": "bun packages/schema/scripts/emit.ts",
  "golden": "bun scripts/golden.ts",
  "build": "bun scripts/build.ts",
  "build:bin": "bun scripts/build.ts --bin"
}
$ git grep -n -E "test:(fast|cli)" -- . ":!.agents/specs" ":!docs/audit-*" ":!**/runs/**"
exit 1
$ bun run test:fast
error: Script not found "test:fast"
$ bun run test:cli
error: Script not found "test:cli"
