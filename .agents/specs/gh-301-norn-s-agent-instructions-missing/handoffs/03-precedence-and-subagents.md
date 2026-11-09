## Goal
How to work says it outranks any skill, maps what a skill written without norn says to what to do in this step (the "ask the person" row rendered for an attended or unattended step), names a skill among what must not prompt another norn command, and gives subagents their rules.

## Proof
- How to work outranks any skill, and a skill is named among what must not prompt another norn command (AC1): `packages/core/test/unit/brief.test.ts` › "How to work says it outranks any skill, and a skill must not prompt another norn command".
- The skill mapping for stop/wait, push or pull request, and other norn commands (AC2): same file › "How to work maps what a skill says to what to do in this step".
- The "ask the person" row follows the step, ask in this session when attended and `norn ask` when not (AC3): same file › "the ask-the-person row follows the step: ask in this session when attended, norn ask when not".
- The subagent rule (AC4): same file › "How to work gives a subagent the rules its work can break, and none to one that only reads".
- All four went red before the code change. `bun run test` (1563 pass) and `bun run typecheck` are green. Brief snapshots changed only for the new How to work lines.

## Easy to miss
- `protocolLines` now takes the step (`{ handoff_file, attended }`, the plan's prefactor), not a handoff path. Its callers in `assets.test.ts` and `test/repo/repo.test.ts` pass `attended: false`.
- The subagent line says "no edit under `runs/`", not "never edit", so the repo test that requires exactly one "never edit" rule still holds.

## Not proven yet
- Nothing in this slice's criteria.

## Notes
- Merge overlap with gh-301/01: after 01 lands, the other-commands rule lives in the core rules list. Carry over the words "a skill," ("never because a skill, a refusal, this brief or the inbox names it"). The subagent line lists the rules a subagent can break; their reasons come from 01's rules list.

## Resume
- Nothing left in implement. Next is the workflow's next step (review).
