---
id: gh-342/02
title: One store function turns workflow text into a loaded workflow
depends_on: []
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
---

## Goal
The workflow listing and the lost-record restart in `norn story checkout` load a workflow's text through the same store function (parse, the name check, `source`, `hash`), so flattening later lands in one place and both paths pin the same thing.

## Scope
User stories: groundwork for a unit pinning the flattened workflow, including a lost record's restart (prefactor 2). Seams: S1, S2. Out: any `use:`/`like:` behaviour (slices 03, 04, 07).

## Acceptance
- AC1 Given a workflow file whose `name` differs from its file name, when the listing loads it, then it is reported broken with "must equal the file name", exactly as today. — verifier: test
- AC2 Given a story whose record is lost and whose branch holds a workflow file with a bad name or failing validation, when `norn story checkout` restarts it, then it refuses with `workflow_invalid` as today; and with a valid workflow it pins that workflow's text with the same fingerprint the listing gives. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
Behaviour-preserving prefactor; existing listing and takeover-record-lost tests must stay green unchanged. Plan: Prefactoring 2, D1 (the function stays synchronous; the async `git show` reads stay in the restart).
