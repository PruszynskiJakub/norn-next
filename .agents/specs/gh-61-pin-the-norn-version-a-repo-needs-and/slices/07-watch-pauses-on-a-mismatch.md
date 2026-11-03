---
id: gh-61/07
title: "`norn watch` pauses ticks on a mismatch and notifies once"
depends_on: [ gh-61/05 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
---

## Goal
`norn watch` re-checks the repo's version before every tick, skips the ticks it may not run with one JSON line each, notifies the person once per mismatch, never exits for it, and resumes when the version matches again.

## Scope
Behaviour: B11. Seams: S1. Out: cron `tick` (it just exits 3, slice 05).

## Acceptance
- AC1 (B11) `norn watch --max-ticks 4` on 0.18.1; after the first tick the team file in the main checkout is set to 0.19.0 → ticks 2–4 each print a JSON line carrying the B6 refusal and do nothing; the fake notifier receives exactly one notification "this repo needs norn 0.19.x; ticks paused"; `watch` exits as after a normal run. — verifier: test
- AC2 (B11) The version moves back to a matching one → the next tick runs normally; a later mismatch with another version notifies again. — verifier: test

## Checks
- `bun run test`
- `bun run test:integration`
- `bun run typecheck`

## Notes
D8: the guard reruns per tick with the config reloaded; the notified pair is kept in the watch process.
