---
id: gh-301/01
title: Every hard rule in How to work gives its reason
depends_on: []
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
---

## Goal
An agent reading How to work sees, after each hard rule, the one clause saying what breaks if it is not followed, all rendered from one list of hard rules in core that the hooks will reuse.

## Scope
User stories: the no-survey rule says why; the only-four-norn-commands rule says why, read-only commands included; the run state rule says a hand edit makes the unit `corrupt`; the no-push rule says a push outside norn has no receipt; the no-switch rule says it leaves the unit's branch; every other hard rule carries its reason. Seams: S1. Prefactor 1 (one hard-rules list in core, each entry with its text and reason). Out: precedence, the skill mapping, "a skill" in the other-commands rule and the subagent rule (gh-301/03); Where you run (gh-301/04); hook use of the list (gh-301/05–07).

## Acceptance
- AC1 Given any brief, when How to work renders, then the rule against surveying the repository, `.agents/`, `.claude/` or the machine says the brief already holds what the step needs, a survey spends context on what it doesn't, and other units' run state and handoffs are not this unit's to act on. — verifier: test
- AC2 Given any brief, then the rule to run only `brief`, `done`, `ask` and `stuck` says the brief carries this unit's state rendered fresh each time and other norn commands drive units and gates that are the person's or show other units' state, so a read-only `norn status --json` or `norn story view` is forbidden too. — verifier: test
- AC3 Given any brief, then the run state rule says a hand-edited file fails validation and makes the unit `corrupt`, the no-push rule says a push outside norn is an effect with no receipt (receipts come before effects), and the no-switch rule says a switch leaves the unit's branch, where norn commits what is left at the report. — verifier: test
- AC4 Given any brief, then every hard rule How to work renders carries a non-empty reason clause, and the rule texts and reasons come from the one list the hooks will read (a rule added to the list without a reason fails a test). — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
The brief snapshots change only by the added reason clauses; review reads that diff. The list's reasons become the hooks' refusal reasons and the session-start note, so word each one to stand alone as a sentence fragment after the rule.
