# Static checks (B7-B13)
B7: `bun run test:fast` / `bun run test:cli` → error: Script not found (exit 1). `git grep -E 'test:fast|test:cli'` over package.json, AGENTS.md, README, CONTRIBUTING, .agents/workflows, .github, skills, scripts, test, packages → no match. Only records under .agents/specs/ (runs/, older specs) name them (exempt, D14).
B8: bug/quick/slice/story.yaml test check: `bun install --frozen-lockfile && bun run test && bun run test:integration && bun run typecheck`.
B9: implement instructions in bug/quick/slice/story.yaml: "Run `bun run test` (the unit tier) after each change, and the type check; the integration tier runs in the `test` check and the e2e tier runs in CI...".
B10: packages/cli/assets/skills/norn-implement/SKILL.md:20 "Run the type check and the repo's fast suite after each change. Slower tiers (integration, end-to-end) run in their own check"; no "full suite".
B11/B12: .github/workflows/ci.yml: job unit (bun run test + typecheck); integration, e2e, package all `needs: unit`; e2e matrix shard [1,2,3], fail-fast: true, `bun run test:e2e --shard=N/3`. Not observed on a PR: `gh pr list --head <branch>` → [], `gh run list --branch <branch>` → [].
B13: .github/workflows/release.yml:137-144 Test step runs `bun run test` and `bun run typecheck` only.
