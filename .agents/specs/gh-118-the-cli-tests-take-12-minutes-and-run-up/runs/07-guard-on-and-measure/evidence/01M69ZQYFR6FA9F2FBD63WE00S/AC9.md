# AC9 (B14) — pass
In a copy of HEAD, I added packages/view/test/foo.test.ts. `bun test test/repo/repo.test.ts` exits 1:
"(fail) test layout (AGENTS.md) > gh-118 B14: every test file sits in a tier folder" with
`"packages/view/test/foo.test.ts is not in a tier folder (unit/, integration/, test/e2e/, test/repo/)"` (AC9.log).
On this checkout: `git ls-files '*.test.ts' | grep -vE '/test/unit/|/test/integration/|^test/e2e/|^test/repo/'` → empty. repo.test.ts passes in every unit run (AC7).
