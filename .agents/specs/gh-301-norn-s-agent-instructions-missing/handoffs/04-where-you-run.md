## Goal

Every brief opens, right after its opening line, with a "Where you run" section built only from recorded facts (attended, runner, effective and requested mode); the `--json` brief's `where` carries those facts (`mode_requested`, `runner`) and no `mode_note`.

## Proof

All in `packages/core/test/unit/brief.test.ts` › "Where you run: the brief's situation, from the facts norn records" (each went red before the code):
- Where you run opens every brief, before Your work (AC1) › "opens every brief: right after the opening line, before Your work"
- attended: person here, ask here, done once they agree; banner gone; no permission line (AC2) › "attended: …"
- unattended: runner named (herdr pane / headless / none), nobody reads this session, `norn ask` parks the step, permission prompt parks the step (AC3) › "unattended: …"
- auto: report starts the next step at once, handoff must stand alone; manual: next agent step waits for a person (AC4) › "auto: … manual: …"
- auto asked, no runner: runs manual and why; no "Mode: …" line (AC5) › "auto asked with no runner: …"
- `--json` `where` has `attended`, `mode`, `mode_requested`, `runner`, no `mode_note` (AC6) › "the --json brief carries the facts only: …"
- every combination of attended × mode × runner: one line per fact, none promises a supervisor (AC7) › "every combination: …"
- Snapshots in `__snapshots__/brief.test.ts.snap` changed only by the new section and the removed banner.
- `bun run test` (1566 pass) and `bun run typecheck` green.

## Easy to miss

- An attended step's effective mode is always manual, but what its report sets off follows the story's mode and the runner, so the mode line renders from `mode_requested` + `runner`, not from `mode`. An attended step under auto with a runner says "Mode auto: your report starts the next step at once".
- The fallback line shows whenever auto was asked and there is no runner, attended or not.

## Not proven yet

- The integration pin in `packages/cli/test/integration/agent-protocol.test.ts` ("attended steps never block") was updated to the new attended line but not run locally (integration tier runs in CI).

## Notes

- `BriefInput.runner` is now typed `herdr | headless | null` (from `ResolvedConfig["runner"]["adapter"]`); the cli already passes `config.runner.adapter`.
- No schema or doc describes the `--json` brief's `where`, so no `schema:emit` / `docs:emit` was needed.
- The at-limit counter line stays between the opening and Your work (D2), so it now renders under the Where you run section.
- "Mode auto: … starts the next step at once" is not literal when the next step is attended or `max_agents` is full; left as the spec words it.

## Resume

Nothing left in this slice; the next step is review.
