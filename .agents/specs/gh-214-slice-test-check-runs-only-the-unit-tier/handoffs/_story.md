## Goal

The slice workflow's `test` check runs only the unit tier and the type check; the integration tier stays in the story's `test` check and in CI.

## Progress

- `.agents/workflows/slice.yaml`: `test.run` is now `bun install --frozen-lockfile && bun run test && bun run typecheck` (timeout kept at 15m); implement instructions say the integration tier runs in the story's `test` check once every slice is integrated.
- `AGENTS.md` Commands: notes that a slice's `test` check runs only the unit tier and the type check.
- `test/repo/repo.test.ts` AC2/AC3 updated first (red), then green: slice expects the unit-only command and the story's-`test`-check wording.
- Shipped `packages/cli/assets/workflows/slice.yaml` left alone: it already runs only `bun test` (unit tier).
- `bun run test` (1257 pass) and `bun run typecheck` green.

## Resume

Nothing left for implement; the next step is the `test` check.
