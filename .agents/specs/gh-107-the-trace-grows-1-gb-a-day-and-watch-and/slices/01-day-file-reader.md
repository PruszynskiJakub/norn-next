---
id: gh-107/01
title: One day-file line reader that skips lines by type
depends_on: []
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: agent }
---

## Goal
Every reader of the trace day files goes through one store line reader that can be observed and that skips lines of event types its caller did not ask for without parsing them, so `norn trace`, inbox history and the timelines print the same as before at lower cost.

## Scope
Behaviour: B4. Seams: S1, S2. Prefactoring 1 (one day-file line reader), D2 (type first, skip by prefix). Adds the store trace-read observer (off by default) that later slices assert "no day file opened" with. Out: who reads the trace (03), hook files (04).

## Acceptance
- AC1 (B4) Given a trace with ticks, hook events and step events, when `norn trace <unit>` runs, then it prints the same events as before this slice. — verifier: test
- AC2 (B4) Given a day file holding a broken line whose type prefix names an event type `norn trace <unit>` does not show, when it runs, then it does not report that line; a reader that reads every type still reports it as before. — verifier: test
- AC3 (B4) Given trace lines written by norn after this slice, when they are read back, then each has `type` as its first key, and with the trace-read observer on, every day file a reader opens is seen by the observer (trace, inbox history, the hook-fact scan and the blocked-hook count all open day files through it). — verifier: test
- AC4 (B4) Given a throwaway repo with a few days of trace, when `norn trace <unit>` and `norn inbox --history` run with the build of this branch, then their output matches the released norn's output on the same trace. — verifier: agent

## Checks
- `bun test packages/store/test/config-trace.test.ts`
- `bun test packages/cli/test/inbox-why.test.ts packages/cli/test/agent-protocol.test.ts`
- `bun run typecheck`

## Notes
Model the observer on store's `setSpawnObserver`. Lines written by older norns may not have `type` first; the reader must fall back to parsing such a line rather than skip it wrongly (check the prefix only when it is a `{"type":"…"` prefix). No behaviour change otherwise: golden, transcripts and observe snapshots stay as they are.
