---
id: gh-301/04
title: Where you run opens every brief
depends_on: []
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
---

## Goal
Every brief opens, right after its first line, with a Where you run section built only from facts norn records (attended or not, the runner, the effective and requested mode), each line saying what the fact means for the work; the `--json` brief carries the same facts.

## Scope
User stories: Where you run opens every brief; attended: the person is here, ask here, done once they agree; unattended: the runner named, nobody reads chat, ask via `norn ask`; auto: the report starts the next step and the handoff must stand alone; manual: the next step waits for a person; auto without a runner explained; a permission prompt parks the step; it replaces the mode line and the Attended banner; the `--json` brief carries the runner as a fact; it states only what norn records. Seams: S1. Decisions D1, D2. Out: How to work's text (gh-301/01, 03); the hooks' attended reminder (gh-301/07).

## Acceptance
- AC1 Given any brief, attended or not, then a "Where you run" section follows the opening line and comes before Your work. — verifier: test
- AC2 Given an attended step, then Where you run says a person works with the agent in this session, to ask them here, and to report `done` only once they agree; the separate "Attended step" banner is gone. — verifier: test
- AC3 Given an unattended step, then Where you run names the runner (a herdr pane or headless), says no person reads this session, that a question goes through `norn ask`, which parks the step until answered, and that a permission prompt parks the step until a person answers it; an attended brief has no permission-prompt line. — verifier: test
- AC4 Given auto mode, then Where you run says the report starts the next step at once and the next agent has only the handoff and the receipts; given manual mode, it says the next step waits for a person to start it. — verifier: test
- AC5 Given a story that asked for auto on a machine with no runner, then Where you run says the step runs manual because there is no runner and what that means for the report; the old "Mode: …" line appears nowhere. — verifier: test
- AC6 Given `norn brief --json`, then `where` carries `attended`, `mode`, `mode_requested` and `runner` (`herdr`, `headless` or null) as facts, with no `mode_note` and no rendered prose. — verifier: test
- AC7 Given every combination of attended, mode, requested mode and runner, then each Where you run line follows from one of those facts, and none promises anything norn doesn't do (no supervisor answering an ask). — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
The at-limit counter line stays where it is (D2). Also update the banner pin in `agent-protocol.test.ts` (integration tier, CI runs it) and the `--json` brief's schema and docs if they describe `where`; run `bun run schema:emit` / `bun run docs:emit` if either changes. Nothing outside the brief and its test reads `mode_note` (D1).
