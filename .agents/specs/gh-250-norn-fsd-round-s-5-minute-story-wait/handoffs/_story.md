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

- review#1: approve, no findings. Verified `/usr/bin/timeout` exists on this macOS, `160s` parses (`parseDuration`), no other doc or source still says `--timeout 5m` / "five minutes" (installed copy `.agents/skills/` excepted, release refreshes it). test#1 passed (unit, integration, typecheck).

| Item | Verifier | Proven by |
| --- | --- | --- |
| Wanted: waits under the foreground limit (`--timeout 160s`, Bash timeout about 178 s, `timeout 170 gh run watch`) | test | `packages/cli/test/unit/assets.test.ts` › fsd-round terms test ("under the harness's foreground limit", "Bash timeout about 178 s", both `--timeout 160s` waits, `timeout 170 gh run watch <run-id> --exit-status`, no `--timeout 5m`) |
| Wanted: run norn and gh directly, never through a script or in the background | test | `packages/cli/test/unit/assets.test.ts` › fsd-round terms test ("never through a script or in the background") |
| Wanted: exit 7 worded "the timeout passed" | test | `packages/cli/test/unit/assets.test.ts` › fsd-round terms test ("exit 7: the timeout passed", no "five minutes") |
- review#1 approve: Approve, no findings: fsd-round waits at 160s/178s Bash/timeout 170 gh run watch, direct commands only, exit 7 'the timeout passed'; every Wanted item asserted in assets.test.ts

## Resume

Review approved; next is whatever the workflow routes after review (QA/PR).
