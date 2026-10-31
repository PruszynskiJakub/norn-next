# QA gh-75/03 — targets and terminal prompts
Suite: `bun test packages/cli` 345 pass, targets.test.ts 8 pass, typecheck clean (tests.txt).
Real-CLI checks ran `bun packages/cli/src/main.ts` against harness-seeded throwaway repos (3 seeds: two units+slice, one unit, none), with the agent env vars unset; prompts under a pty via `script -q /dev/null`.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B54) | pass | AC1.md | |
| AC2 (B56) | pass | AC2.md | |
| AC3 (B57) | pass | AC3.md | order = inbox first, then stories; today's `norn status` prints stories first (inbox-first status is slice 04, B9) |
| AC4 (B58) | pass | AC4.md | |
| AC5 (B59) | pass | AC5.md | |
| AC6 (B60) | pass | AC6.md | |
| AC7 (B57,B58) | pass | AC7.md | Up at the top wraps to the last item |
