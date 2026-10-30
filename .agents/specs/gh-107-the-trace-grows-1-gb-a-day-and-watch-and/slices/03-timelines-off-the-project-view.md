---
id: gh-107/03
title: Cockpit, status and inbox read no trace
depends_on: [ gh-107/01 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: agent }
---

## Goal
`norn cockpit`, `status`, `status --segment`, `inbox` and `orient` stop reading the trace; only the views that show timelines read it, through a separate timeline read in `@norn/view`. The cockpit's memory stops growing with the trace.

## Scope
Behaviour: B1, B2, B3. Seams: S1. D1. PRD: amend X1 (the project view carries no timeline; a timeline read is separate). Out: `norn trace` output (01), hook files (04).

## Acceptance
- AC1 (B1) Given a trace with several day files, when `norn cockpit --json` runs and refreshes, then the trace-read observer sees no day file opened. — verifier: test
- AC2 (B2) Given a trace with several day files and the same repo with an empty trace, when `norn status`, `norn status --segment` and `norn inbox` run, then each prints the same output in both and the observer sees no day file opened. — verifier: test
- AC3 (B3) Given a repo with trace over the 14-day window, when timelines are read through the view's timeline read and through `norn trace`, then they hold the same entries as before this slice, and `loadProjectView` returns no timeline and no trace parse errors. — verifier: test
- AC4 (B1, B2) Given a synthetic trace like the reported one (14 day files, ~2 GB, one live run with 400+ hook facts), when the benchmark script runs `norn cockpit` refreshing every 5 s for a minute and `norn status` against it and against an empty trace, then the cockpit's footprint stays within ~10% of its empty-trace footprint and `status` takes about the same time in both. — verifier: agent

## Checks
- `bun test packages/view/test packages/cli/test/cockpit.test.ts packages/cli/test/segment.test.ts packages/cli/test/inbox-why.test.ts packages/cli/test/observe-snapshots.test.ts`
- `bun run typecheck`

## Notes
The benchmark script (a synthetic-trace generator plus timing/footprint run) lives in `scripts/` and is reused by the QA of 04 (B10). Observe snapshots check inbox parity; the inbox must not change.
