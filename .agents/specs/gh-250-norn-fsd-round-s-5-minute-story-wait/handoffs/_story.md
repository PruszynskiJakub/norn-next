# gh-250 handoff

## Goal

Make `norn-fsd-round`'s waits fit a harness that backgrounds long foreground commands (SK3): waits under the foreground limit, norn and gh run directly, exit 7 worded as "the timeout passed".

## Progress

- `packages/cli/assets/skills/norn-fsd-round/SKILL.md`: `--timeout 5m` → `--timeout 160s` (gate and merged waits, subagent brief); `gh run watch` bounded with `timeout 170` (exit 124 → watch again); new Shape bullet "Every wait stays under the harness's foreground limit" with Claude Code's values (≈180 s limit, `--timeout 160s`, Bash timeout about 178 s, `timeout 170 gh run watch`) and "run every norn and gh command directly, never through a script or in the background" (a wrapper hides the command from the permission check); brief's exit 7 now "the timeout passed".
- "background task" was reworded to "in the background": the glossary lint bans `task`.
- `packages/cli/test/unit/assets.test.ts`: the fsd-round terms test asserts the new phrases and that no `--timeout 5m` / "five minutes" remains (red first, then green).
- Installed copy `.agents/skills/norn-fsd-round/` left alone (release refreshes it, per AGENTS.md). `story-wait.ts` needed no change.
- `bun run test` and `bun run typecheck` green.
- implement#1 done: norn-fsd-round: waits at --timeout 160s (Bash timeout ~178 s), gh run watch bounded with timeout 170, run norn/gh directly never via script or background, exit 7 = 'the timeout passed'; assets test asserts the new wording and no 5m left

## Resume

Nothing left for implement; next is the workflow's checks/review.
