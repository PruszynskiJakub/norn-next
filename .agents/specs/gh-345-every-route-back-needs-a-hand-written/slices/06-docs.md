---
id: gh-345/06
title: Docs for derived counters and max on an edge
depends_on: [ gh-345/05 ]
status: integrated
criteria:
  - { id: AC1, verifier: agent }
  - { id: AC2, verifier: test }
---

## Goal
An author can write a workflow from the docs alone. The docs give the table of defaults, both naming rules, `max:` on an edge, and when `counter:`/`counters:` is still needed.

## Scope
User stories: the workflow docs (recipes and concepts) giving the defaults table, `<step>.<outcome>` and `<use step>.<exit>` naming, `max:` on an edge and when `counters:` is still needed; the glossary's counter entry saying a counter is named or derived from its edge. Seams: docs. Out: any code.

## Acceptance
- AC1 Given the workflow recipes and concepts docs, when an author reads them, then they find the defaults table (check fail and exits-named outcomes 5, gate reject 2, conflict 2 with its reset, stale 10, agent send-back on an uncounted loop 3), both naming rules, `max:` on an edge with its two refusals, the mixed-kind exit refusal, and when `counter:`/`counters:` is still needed (a shared budget, a custom `reset_on`). The glossary's counter entry says a counter is named or derived from its edge. — verifier: agent
- AC2 Given the edited docs, when the unit tier runs, then the docs lints pass (glossary terms, emitted reference current after `bun run docs:emit`). — verifier: test

## Checks
- `bun run docs:emit`
- `bun run test`

## Notes
D11. Depends on slice 05 (and through it on 02 and 03): the docs are written against the rules as built (D4, D5, D7), and `docs:emit` emits the reference from the final shipped workflows. Examples in the docs should follow the design record's `quick.yaml` shape (`fail: { to: implement, max: 3 }`, a bare `reject: implement`).
