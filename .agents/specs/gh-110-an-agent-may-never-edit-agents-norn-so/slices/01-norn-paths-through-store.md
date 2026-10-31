---
id: gh-110/01
title: Every norn path goes through store's path functions
depends_on: []
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
---

## Goal
Prefactor 1: nothing a person sees changes, but every place that names a norn file under the repo (the headless runner's default log dir, doctor's scratch repo, the cli integration tests) asks store for it, so the layout change in slices 03 and 04 is a change in one module.

## Scope
Behaviour: none changes; prepares B1, B2, B5. Seams: S1 (the whole suite as it is). Out: any path change (slices 03, 04); the shared validator (slice 02).

## Acceptance
- AC1 (B1, B2, B5 — prefactor) Given the current layout, when the full suite runs, then it passes with the transcripts, observe snapshots and golden corpus unchanged. — verifier: test
- AC2 (B1, B2, B5 — prefactor) No package source outside store's path module, and no test outside one harness helper, spells a `.agents/norn/` path literally (code comments, user-facing message text and test fixtures that build an old-layout repo on purpose excepted); a repo lint test enforces it. — verifier: test
- AC3 (B5 — prefactor) The headless runner's default log dir is computed from store's machine-local dir for the checkout, not a literal path, and still resolves to the same place today. — verifier: test

## Checks
- `bun test`
- `bun run typecheck`

## Notes
Plan Prefactoring 1 and Risks ("test churn"). About 40 test files change, mechanically; no assertion changes meaning. The lint added in AC2 is what keeps later slices from re-spelling the old paths; the message texts are renamed in slice 03 (D11), so the lint may allow-list them until then.
