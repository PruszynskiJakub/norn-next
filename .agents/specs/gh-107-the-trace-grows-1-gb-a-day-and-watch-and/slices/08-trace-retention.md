---
id: gh-107/08
title: norn tidy prunes day files older than trace.retain
depends_on: []
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
  - { id: AC8, verifier: test }
  - { id: AC9, verifier: test }
  - { id: AC10, verifier: test }
  - { id: AC11, verifier: agent }
---

## Goal
The trace on disk stays bounded once the person tidies: `trace.retain` (default 14d, at least 14d) sets a window, `norn tidy` deletes day pairs older than it, `norn doctor` hints when the trace holds more, and `norn why` refuses clearly for a pruned tick.

## Scope
Behaviour: B20, B23, B24, B25, B26, B27, B31, B32, B33, B34. Seams: S1. D10's `tick_pruned` half, D11, D12 (day pairs), D13. PRD: a new retention rule in the observability section. Out: pruning hook files, briefings and transcripts (09).

## Acceptance
- AC1 (B23) Given no `trace.retain` in any config layer, when `norn tidy` runs, then it prunes what is older than 14 days; given `trace.retain: 30d`, then what is older than 30 days. — verifier: test
- AC2 (B24) Given `trace.retain: 14d`, when `norn tidy --retain 30d` runs, then nothing newer than 30 days is pruned. — verifier: test
- AC3 (B25) Given `--retain 7d` or `trace.retain: 7d`, when `norn tidy` runs, then it exits 3 with "the trace window must be at least 14d", a do-instead naming 14d, and nothing is deleted; `norn doctor` reports such a config value as a warning and config loading does not fail. — verifier: test
- AC4 (B26) Given `--retain soon` (or a non-duration `trace.retain`), when `norn tidy` runs, then it is refused naming the expected form (e.g. `14d`) and nothing is deleted. — verifier: test
- AC5 (B27) Given day files (with chunks files where present) from 40 to 0 days ago and a 14d window, when `norn tidy` runs, then the 26 oldest day pairs are deleted and the last 14 days stay; `trace/workflows/` is kept. — verifier: test
- AC6 (B31) Given day pairs beyond the window, when `norn tidy --dry-run` runs, then it lists each day pair with the bytes it would free and the total, and the trace is unchanged afterwards. — verifier: test
- AC7 (B32) Given `norn tidy` has run, when it runs again, then it reports nothing pruned from the trace. — verifier: test
- AC8 (B33) Given 45 days of trace and `trace.retain: 14d`, when `norn doctor` runs, then it gives a hint (not a failed check) with how many days and bytes are beyond the window, naming `norn tidy`; within the window, no hint. — verifier: test
- AC9 (B34) Given ticks run over 30 fake-clock days without `norn tidy`, then no day file is deleted. — verifier: test
- AC10 (B20) Given a tick id whose ulid time is older than now minus the window and whose day is gone, when `norn why --tick <id>` runs, then it exits 3 with code `tick_pruned`, "tick … is older than the trace retained (14d)", and a do-instead pointing at a newer tick (`norn trace <unit>`). — verifier: test
- AC11 (B27, B31, B33) Given a throwaway repo with a hand-made trace spanning 40 days, when the person-facing `norn doctor`, `norn tidy --dry-run` and `norn tidy` run with this branch's build, then the hint, the listing and the deletion read sensibly and match. — verifier: agent

## Checks
- `bun test packages/cli/test/housekeeping.test.ts packages/cli/test/config.test.ts packages/cli/test/why-version.test.ts`
- `bun run typecheck`

## Notes
Independent of chunks: tidy deletes `<day>.chunks.jsonl` beside an old day file whenever it exists, so it need not wait for 06. `trace.retain` scope is `machine`; the 14d minimum is checked where it is used, not in the schema (D11). Tidy runs under the tick lock it already takes.
