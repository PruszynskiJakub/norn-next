---
id: gh-107/06
title: Tick facts stored as content-addressed chunks with 64-fact hook blocks
depends_on: [ gh-107/02 ]
status: active
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
  - { id: AC11, verifier: test }
  - { id: AC12, verifier: test }
  - { id: AC13, verifier: person }
---

## Goal
A tick line keeps its decisions but stores its facts as a `$chunked` skeleton whose chunks live once in the day's chunks file, with each run's hook facts as fixed 64-fact blocks written once, so a quiet tick writes a few kilobytes instead of ~650 KB, a long agent step makes the trace grow linearly with its hooks, and `norn why` still replays every tick exactly, old and new.

## Scope
Behaviour: B13, B14, B15, B16, B17, B18, B19, B21, B22, B35. Seams: S1, S2. D6, D7 (hook blocks included), D8, D9, D10's corrupt-entry half, D14, D15. PRD: amend O4, O5, X4. Out: the `tick_pruned` refusal (08).

## Acceptance
- AC1 (B13) Given two ticks a minute apart with nothing changed, when the second runs, then it adds a tick line and no new chunk, and the bytes both add to the trace together are under 5 KB. — verifier: test
- AC2 (B15) Given a tick whose chunks were appended but whose tick line was not (killed in between), when earlier ticks of the day are read, then they read as before and the extra chunks are harmless. — verifier: test
- AC3 (B16) Given the remembered set of chunks already written today is lost or stale (the chunks file changed size behind the process), when the next tick runs, then it writes its chunks again and every tick of the day still reads the same. — verifier: test
- AC4 (B17) Given a chunked tick, when `norn why --tick <id>` runs, then the rebuilt facts equal the observed facts byte for byte and decide gives the recorded decisions; a round-trip over the golden cases' facts at the store trace interface rebuilds each byte for byte. — verifier: test
- AC5 (B18) Given a full-facts tick written the way the previous version wrote it, when `norn why --tick <id>` runs, then it replays as before (including workflow sources from `trace/workflows/`). — verifier: test
- AC6 (B19) Given one day's day file and chunks file copied alone into an empty trace folder, when each tick of that day is read, then every tick reads and replays. — verifier: test
- AC7 (B21) Given a chunked tick one of whose chunk lines was removed, when the tick is read, then it is reported as a corrupt trace entry naming the missing hash and no facts are returned; `norn why --tick <id>` exits 4 with code `trace_corrupt` and replays nothing. — verifier: test
- AC8 (B22) Given the cli harness tests run with golden harvesting on, when they harvest from chunked ticks, then the harvest yields the same case names and decisions as from full ticks. — verifier: test
- AC9 (B35) Given a chunked tick line, when it is checked against the older tick schema shape and read by `norn inbox --history`, then it validates (`facts` an object) and its decisions and inbox changes are read. — verifier: test
- AC10 (B35) Given full-facts ticks written after chunked ones (as an older norn would after a downgrade), when the new version reads them, then `norn why` replays both kinds. — verifier: test
- AC11 (B14) Given a run with 416 hook facts appended over its life, when its ticks are written, then 6 full blocks are each written once, and each later tick adds only the last partial block when it changed. — verifier: test
- AC12 (B14, B17) Given chunked ticks whose runs carry `$blocks` references, when `norn why --tick <id>` runs, then the rebuilt facts equal the observed facts byte for byte and decide gives the recorded decisions. — verifier: test
- AC13 (B35) The PR body names the downgrade as its merge danger: an older norn cannot replay chunked ticks and there is no compatibility mode. — verifier: person, because judging the PR's stated merge danger is a reviewer's call at the `ready` gate

## Checks
- `bun test packages/store/test/config-trace.test.ts`
- `bun test packages/cli/test/why-version.test.ts packages/cli/test/inbox-why.test.ts packages/core/test/golden.test.ts`
- `bun run typecheck`

## Notes
Chunks and hook blocks ship together (D15, ruled at approve-plan): `$blocks` is part of the tick line skeleton, so splitting them would change the line format twice. This is the largest slice; keep it in one context by ordering (Risks): first the spike — split a real recorded tick from this repo's trace by D7 and measure the inline part; if over 5 KB, make the largest inline part a chunk too, without returning to the person — then the S2 tests (B14, B15, B16, B19, B21 and the byte-for-byte round-trip guarding key order) before any CLI path reads chunks, then S1 (B13, B17, B18, B22, B35: switch `why` and the golden harvest over). Blocks are cut by position in the run's refined hook list; Claude's refinement looks only backwards, so full blocks stay stable (D7). A late hook simply makes a new block. Slice 07 (hook blocks) was merged into this one and its file removed; the key gh-107/07 is unused.
