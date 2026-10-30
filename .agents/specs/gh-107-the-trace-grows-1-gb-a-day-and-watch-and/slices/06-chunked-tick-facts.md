---
id: gh-107/06
title: Tick facts stored as content-addressed chunks
depends_on: [gh-107/02]
status: planned
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
  - { id: AC11, verifier: person }
---

## Goal
A tick line keeps its decisions but stores its facts as a `$chunked` skeleton whose chunks live once in the day's chunks file, so a quiet tick writes a few kilobytes instead of ~650 KB, and `norn why` still replays every tick exactly, old and new.

## Scope
Behaviour: B13, B15, B16, B17, B18, B19, B21, B22, B35. Seams: S1, S2. D6, D7 (without hook blocks: a run's hooks stay inside its story chunk until 07), D8, D9, D10's corrupt-entry half, D14. PRD: amend O4, O5, X4. Out: 64-fact hook blocks (07), the `tick_pruned` refusal (08).

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
- AC11 (B35) The PR body names the downgrade as its merge danger: an older norn cannot replay chunked ticks and there is no compatibility mode. — verifier: person, because judging the PR's stated merge danger is a reviewer's call at the `ready` gate

## Checks
- `bun test packages/store/test/config-trace.test.ts`
- `bun test packages/cli/test/why-version.test.ts packages/cli/test/inbox-why.test.ts packages/core/test/golden.test.ts`
- `bun run typecheck`

## Notes
Start with the spike from Risks: split a real recorded tick from this repo's trace by D7 and measure the inline part; if over 5 KB, make the largest inline part a chunk too, without returning to the person. Guard byte-for-byte replay (key order) with the S2 round-trip before switching `why` over. Hook blocks are split out to 07 so this slice fits one context; until 07 lands a run with many hooks rewrites its story chunk when a hook arrives — AC1 holds because a quiet tick changes no story. If the reviewer prefers one PR for 06+07, that is the person's call.
