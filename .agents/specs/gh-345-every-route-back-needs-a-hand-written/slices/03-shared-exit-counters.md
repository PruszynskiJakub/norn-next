---
id: gh-345/03
title: One derived counter per shared-file exit
depends_on: [ gh-345/01, gh-345/02 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
---

## Goal
A route that leaves a shared file through a named exit is counted by one counter, `<use step>.<exit>`, shared by every inner edge that leaves through it. Its default comes from the kind of those inner edges. Where the kinds disagree, the author must write `max:` on the use step's route.

## Scope
User stories: a shared exit counted once as `<use step>.<exit>`; its default from its feeders' kind, with `max:` on the use route overriding it; mixed feeder kinds refused without `max:`; doctor reporting that refusal with its exit. Seams: S1, and S4 for doctor. Out: shipped workflow edits (slice 05).

## Acceptance
- AC1 Given a shared file with three check `fail` edges leaving through exit `broken`, used by step `base-update` whose route `broken: implement` has no counter, when the workflow is loaded, then all three flat edges pin the one counter `base-update.broken` with max 5. — verifier: test
- AC2 Given a shared exit fed only by a gate's `reject` (or only by `stale`), when loaded, then its counter `<use step>.<exit>` has max 2 (or 10). Given `max: 3` on the use step's route, then it has max 3. A feeder that derives nothing stays uncounted, and a use route to `$done`/`$stuck` derives nothing. — verifier: test
- AC3 Given a shared exit fed by a `conflict` edge, when loaded, then its counter has max 2 and resets on every other outcome of every feeder step. — verifier: test
- AC4 Given a shared exit fed by a check's `fail` and a gate's `reject` with no `max:` on the use route, when loaded, then the load is refused with an error naming the exit, its use step, and each kind with its edge (check fail: `test.fail`; gate reject: `ready.reject`), pointing at the use route. With `max:` on that route, the feeders share that max with no reset. — verifier: test
- AC5 Given a repo through the cli harness with such a mixed-kind exit and no `max:`, when `norn doctor` runs, then it reports the refusal prefixed with the shared file and naming the exit. — verifier: test (a cli integration test over `norn doctor`, seam S4)

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
D5 and D7. This builds on slice 01's exit information and slice 02's derivation. Agent feeders derive when any one of them lies on an uncounted loop. `max:` on a use route with no deriving feeder counts every feeder. The flattener already refuses an included step named like its use step, so derived names never clash.
