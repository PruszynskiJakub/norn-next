## Goal
How to work says it outranks any skill, maps what a skill written without norn says to what to do in this step (the "ask the person" row rendered for an attended or unattended step), names a skill among what must not prompt another norn command, and gives subagents their rules.

## Proof
Review #1: approve, no blocking findings. `bun run test` (1563 pass) and `bun run typecheck` green; brief snapshots changed only for the new How to work lines.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | How to work outranks any skill; the other-commands rule names a skill next to a refusal, the brief and the inbox | test | `packages/core/test/unit/brief.test.ts` › "How to work says it outranks any skill, and a skill must not prompt another norn command" |
| AC2 | the mapping: stop or wait → `norn stuck`/`norn ask`; push or pull request → leave it to norn; another norn command → only when the person asks directly | test | `packages/core/test/unit/brief.test.ts` › "How to work maps what a skill says to what to do in this step" |
| AC3 | the "ask the person" row reads ask in this session when attended, `norn ask` when not | test | `packages/core/test/unit/brief.test.ts` › "the ask-the-person row follows the step: ask in this session when attended, norn ask when not" |
| AC4 | a subagent works under these rules, gets the ones its work can break with their reasons; one that only reads needs none | test | `packages/core/test/unit/brief.test.ts` › "How to work gives a subagent the rules its work can break, and none to one that only reads" |

## Easy to miss
- `protocolLines` now takes the step (`{ handoff_file, attended }`, the plan's prefactor), not a handoff path. Its callers in `assets.test.ts` and `test/repo/repo.test.ts` pass `attended: false`.
- The subagent line says "no edit under `runs/`", not "never edit", so the repo test that requires exactly one "never edit" rule still holds.

## Not proven yet
- Nothing in this slice's criteria.

## Notes
- Review note (minor, for the person): in an attended brief the "ask the person" row says "never `norn ask`" while the "stop, or wait for input" row just below still offers `norn ask`, as the spec's mapping requires for any brief. Not blocking; worth a look when gh-301/04's Where you run lands.
- Merge overlap with gh-301/01: after 01 lands, the other-commands rule lives in the core rules list. Carry over the words "a skill," ("never because a skill, a refusal, this brief or the inbox names it"). The subagent line lists the rules a subagent can break; their reasons come from 01's rules list.

## Resume
- Nothing left in review. Next is the workflow's next step.
