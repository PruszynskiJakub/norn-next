---
id: gh-75/02
title: One module builds every command norn prints
depends_on: []
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
---

## Goal
Every command string norn prints for a person or an agent (inbox items, decide details, `nextCommand`, `do_instead` hints, handoff headers, briefs, cockpit actions, `doctor`/`init` next steps) is built in core's printed-commands module, with output byte-for-byte unchanged (prefactor 2). Nothing changes for the user; slice 14 then renames in one place.

## Scope
Behaviour: B69, B70 (nothing changes), groundwork for B7. Seams: S1 plus the pinned suites. Out: renaming any string (slice 14).

## Acceptance
- AC1 (B69, B70) Given the change, when the golden corpus, the effect transcripts, the observe snapshots and every cli integration test run, then they pass with no fixture rewritten: printed output is byte-identical. — verifier: test
- AC2 (B7) A test enumerates every printed-command builder the module exports and asserts each produces today's string for a sample unit, so slice 14's rename is one reviewed diff of that test plus the module. — verifier: test

## Checks
- `bun test`
- `bun run typecheck`

## Notes
Pure refactor; runs in parallel with slice 01. Strings spelled in view, store and cli (not only core) move too; view/store may call core, cli may call core (dependency direction unchanged). If a string is found that cannot move without changing a dependency edge, leave a note rather than adding the edge.
