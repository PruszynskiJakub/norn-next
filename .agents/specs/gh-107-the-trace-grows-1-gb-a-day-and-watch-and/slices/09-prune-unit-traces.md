---
id: gh-107/09
title: norn tidy prunes old hook files, briefings and transcripts
depends_on: [ gh-107/04, gh-107/08 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
---

## Goal
`norn tidy` also prunes the per-unit and per-run trace that outlived the window — hook files of finished units, briefings and transcripts of old runs — and never anything a live run needs.

## Scope
Behaviour: B28, B29, B30 (and B31, B32 extended to these parts). Seams: S1. D12 (hook files, run dirs, never-prune list). Out: day pairs, the window and refusals (08).

## Acceptance
- AC1 (B28) Given gh-3 merged 30 days ago with its hook file last written then, and gh-9 with a live run, when `norn tidy` runs with a 14d window, then gh-3's hook file is deleted and gh-9's is kept. — verifier: test
- AC2 (B29) Given a run that ended 20 days ago and one that ended yesterday, when `norn tidy` runs, then the old run's briefings and transcripts are deleted and yesterday's are kept. — verifier: test
- AC3 (B30) Given a run started 20 days ago and still live, and a workflow recorded 60 days ago, when `norn tidy` runs, then the live run's hook file, briefings and transcripts are kept, the recorded workflow is kept, and `backfill.json`, caches and locks are untouched. — verifier: test
- AC4 (B31, B32) Given prunable hook files and run dirs, when `norn tidy --dry-run` runs, then it lists them with bytes and deletes nothing; after `norn tidy`, a second `norn tidy` prunes nothing. — verifier: test

## Checks
- `bun test packages/cli/test/housekeeping.test.ts`
- `bun run typecheck`
