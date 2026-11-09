## Goal

Every brief opens, right after its opening line, with a "Where you run" section built only from recorded facts (attended, runner, effective and requested mode); the `--json` brief's `where` carries those facts (`mode_requested`, `runner`) and no `mode_note`.

## Proof

Review #1 traceability (tests read and seen asserting each item):

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | Where you run follows the opening line, before Your work, in every brief | test | `packages/core/test/unit/brief.test.ts` › "Where you run: …" › "opens every brief: right after the opening line, before Your work" |
| AC2 | attended: person here, ask here, `done` once they agree; Attended banner gone | test | `packages/core/test/unit/brief.test.ts` › "Where you run: …" › "attended: the person is here, ask here, done once they agree; no banner and no permission line" |
| AC3 | unattended: runner named, nobody reads this session, `norn ask` parks the step, permission prompt parks it; none when attended | test | `packages/core/test/unit/brief.test.ts` › "Where you run: …" › "unattended: names the runner, …" and "attended: …" (no permission line) |
| AC4 | auto: report starts next step, handoff stands alone; manual: next step waits for a person | test | `packages/core/test/unit/brief.test.ts` › "Where you run: …" › "auto: the report starts the next step at once …; manual: …" |
| AC5 | auto asked, no runner: runs manual, why, what it means; no "Mode: …" line | test | `packages/core/test/unit/brief.test.ts` › "Where you run: …" › "auto asked with no runner: …" |
| AC6 | `--json` `where` has `attended`, `mode`, `mode_requested`, `runner`; no `mode_note` | test | `packages/core/test/unit/brief.test.ts` › "Where you run: …" › "the --json brief carries the facts only: …" |
| AC7 | every attended × mode × runner combination: each line from one fact, no supervisor promise | test | `packages/core/test/unit/brief.test.ts` › "Where you run: …" › "every combination: each line follows from one fact, …" |

Snapshots in `__snapshots__/brief.test.ts.snap` change only by the new section and the removed banner (review read the diff). `bun run test` (1566 pass) and `bun run typecheck` green at review.

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
- Merge #1 took in the story branch with a merge (no rebase): its only conflict was `packages/core/test/unit/brief.test.ts`, where this slice's "Where you run" describe block and the story's "How to work outranks any skill and reaches subagents" block were added at the same spot; both kept, one after the other. Snapshots auto-merged. `bun run test` (1570 pass) and `bun run typecheck` green after the merge.

## Resume

Merge #1 resolved the integrate conflict; integrate takes the slice in by a merge next.
