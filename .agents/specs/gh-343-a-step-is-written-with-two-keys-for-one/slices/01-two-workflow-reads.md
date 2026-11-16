---
id: gh-343/01
title: Tell the main-checkout workflow read from the copy read
depends_on: []
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
---

## Goal
Prefactor: every workflow read says whether it reads the main checkout's files or a copy (a pin, a past round's trace or record, a file read from a story branch at a lost-record restart), so the old-wording rule later changes in one place. Nothing a user sees changes.

## Scope
User stories: groundwork for the old-wording rules (old files refused in the main checkout, old pins and branch files still loading, new units pinning the new wording). Seams: S1. Out: any change to what is accepted or refused (slice 09).

## Acceptance
- AC1 Given a workflow file in today's wording, when it is loaded from the main checkout, from a unit's pin, from a past round's trace or record, and from a story branch at a lost-record restart, then each read loads the same workflow as before and the existing loading, pin, trace, record and restart tests stay green. — verifier: test
- AC2 Given each of those readers, when it loads a workflow, then a test at the store loading seam shows it asked for the read kind it stands for (main checkout for the workflow listing and the single-workflow load; copy for the pin, the trace reader, the record reader's branch read and the restart), so no reader is left out when copies start translating. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
Plan Prefactoring 1; risk "a missed reader leaves a past round unreadable". Keep the read kind an explicit argument through the text load and parse functions, not a guess from the path.
