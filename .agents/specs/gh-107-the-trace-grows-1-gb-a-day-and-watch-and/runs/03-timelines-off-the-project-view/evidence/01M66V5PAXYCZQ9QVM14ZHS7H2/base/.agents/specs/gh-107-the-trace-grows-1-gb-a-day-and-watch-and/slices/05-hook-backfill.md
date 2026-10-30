---
id: gh-107/05
title: First tick of the new version backfills live units' hook files
depends_on: [gh-107/04]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
---

## Goal
A person who upgrades while runs are live loses no hook fact: the first tick copies the live units' hook lines from the day files into their hook files once, deduplicated, and finishes on a later tick if interrupted.

## Scope
Behaviour: B11, B12. Seams: S1. D5. Out: pruning `backfill.json` (never pruned, 08/09).

## Acceptance
- AC1 (B11) Given an old-style trace where gh-9 has a live run with 400 hook lines in yesterday's and today's day files and no hook file, when the first tick runs, then gh-9's hook file holds those 400 lines; when a second tick runs, then it copies nothing. — verifier: test
- AC2 (B12) Given a backfill left unfinished (gh-9 not yet in `done`) and a hook that fired into gh-9's hook file meanwhile, when the next tick runs, then the backfill completes and each event id appears once in gh-9's hook file. — verifier: test
- AC3 (B11) Given a run started after the backfill's `since`, when ticks run, then no day file is scanned for it. — verifier: test

## Checks
- `bun test packages/cli/test/agent-protocol.test.ts packages/cli/test/recovery.test.ts`
- `bun run typecheck`

## Notes
Stage the old-style trace by writing day files the way the previous version wrote them (Testing decisions). Append only, never rewrite the unit file, so a concurrent `norn hook` append is never lost. Risk: on a large trace the one-time scan reads every day since the oldest live run; it runs once, under the tick lock, through 01's reader.
