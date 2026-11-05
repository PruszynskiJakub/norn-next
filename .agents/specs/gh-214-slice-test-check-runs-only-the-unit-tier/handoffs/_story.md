## Goal

The slice workflow's `test` check runs only the unit tier and the type check; the integration tier stays in the story's `test` check and in CI.

## Progress

- `.agents/workflows/slice.yaml`: `test.run` is now `bun install --frozen-lockfile && bun run test && bun run typecheck` (timeout kept at 15m); implement instructions say the integration tier runs in the story's `test` check once every slice is integrated.
- `AGENTS.md` Commands: notes that a slice's `test` check runs only the unit tier and the type check.
- `test/repo/repo.test.ts` AC2/AC3 updated first (red), then green: slice expects the unit-only command and the story's-`test`-check wording.
- Shipped `packages/cli/assets/workflows/slice.yaml` left alone: it already runs only `bun test` (unit tier).
- `bun run test` (1257 pass) and `bun run typecheck` green.
- implement#1 done: Slice test check now runs unit tier + typecheck only; slice implement instructions point integration at the story's test check; AGENTS.md updated; repo.test AC2/AC3 pin it. Shipped slice.yaml unchanged (already unit-only).

- review#1: approve, no findings. Traceability (the spec has no numbered Behaviour items; rows are its Wanted items):

| Item | Verifier | Proven by |
| --- | --- | --- |
| W1 slice `test.run` = unit + typecheck only | test | `test/repo/repo.test.ts` › "AC2 (B8): the test check of quick and story runs unit, then integration, then the type check; slice's runs unit and the type check only (gh-214), all in 15 m" |
| W2 story `test` check keeps the integration tier | test | same AC2 test (story expects `UNIT_INTEGRATION`) |
| W3 slice implement instructions say where the integration tier runs | test | `test/repo/repo.test.ts` › "AC3 (B9): the implement step of quick, story and slice names bun run test as the loop, integration in the (story's) test check and e2e in CI" |
| W4 AGENTS.md says the slice check skips integration | person | QA (person): prose in AGENTS.md Commands |
| W5 shipped `packages/cli/assets/workflows/slice.yaml` decided | person | unchanged on purpose: already runs only `bun test` |
- review#1 approve: Review approved, no findings: the slice test check runs unit + typecheck only, the story check keeps the integration tier, the instructions and AGENTS.md say so, and repo.test AC2/AC3 pin it.

## Resume

Review approved; nothing left for review. The next step is norn's to route.
