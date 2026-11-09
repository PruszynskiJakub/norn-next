---
id: gh-301/03
title: How to work outranks any skill and reaches subagents
depends_on: []
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
---

## Goal
How to work says it outranks any skill, maps what a skill written without norn says to what to do in this step (rendered for an attended or unattended step), names a skill among what must not prompt another norn command, and tells the agent how its rules reach a subagent.

## Scope
User stories: the other-commands rule names a skill next to a refusal, the brief and the inbox; How to work outranks any skill; the four-row skill mapping; the "ask the person" row rendered for the step; How to work's subagent rule. Seams: S1. Prefactor 3 (`protocolLines` takes the step). Decision D3. Out: the reasons (gh-301/01), Where you run (gh-301/04), `norn-review`'s subagent rules (gh-301/08).

## Acceptance
- AC1 Given any brief, then How to work says it outranks any skill, and its rule on other norn commands names a skill among what must not prompt one, next to a refusal, the brief and the inbox. — verifier: test
- AC2 Given any brief, then How to work maps "stop, or wait for input" to `norn stuck` or `norn ask`, "push, open or comment on a pull request" to leaving it to norn, and "run another norn command" to only when the person asks directly. — verifier: test
- AC3 Given an attended step, then the "ask the person" row reads ask in this session; given an unattended step, it reads `norn ask`, so the mapping never contradicts the step's situation. — verifier: test
- AC4 Given any brief, then How to work says a subagent the agent starts works under these rules, is given the ones its work can break with their reasons, and one that only reads needs none. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
No edge on gh-301/01 although both edit How to work: this slice can be built and tested on the base, and the overlap in the other-commands rule is resolved at merge (after 01 that rule's text lives in the core rules list). Snapshots for an attended and an unattended brief both change.
