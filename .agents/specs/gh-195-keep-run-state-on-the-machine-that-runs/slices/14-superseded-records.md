---
id: gh-195/14
title: An old holder's record is set aside as superseded
depends_on: [ gh-195/11 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
---

## Goal
When another machine took a story over without a release, the old holder's next tick moves its local record aside as superseded, never pushes it, and shows one Check item; `tidy` deletes it after `trace.retain`. After a clean `norn story handoff`, the old holder's copy is removed quietly instead, with no Check item. This replaces "local work not in the record" items and `orphaned/` folders.

## Scope
Behaviour: B27. Seams: S1. Out: merging a superseded record into the new one (out of scope).

## Acceptance
- AC1 (B27) Given clone A held gh-9 and clone B took it over after expiry (or with `--force`) without a release from A, when A's next tick runs, then A's `runs/gh-9/` is moved to `<machine dir>/superseded/gh-9-<ulid>/`, nothing is pushed for it, and `norn status` on A shows "your record of gh-9 was superseded when <new holder> took it over (last local receipt <NNNN-kind>)". — verifier: test
- AC2 (B27) Given that superseded copy, when `norn tidy` runs before and after it is older than `trace.retain`, then it is kept the first time and deleted the second, and the Check item goes with it. — verifier: test
- AC3 (B27) Given `norn story handoff gh-9` on A and `norn story checkout gh-9` on B, when A's next tick runs, then A's machine dir no longer holds `runs/gh-9/`, nothing is under `superseded/`, and `norn status` on A shows no Check item for gh-9. — verifier: test
- AC4 (B27) The `unpushed_runs` fact, its "local work … is not in the record" Check item and the `orphaned/` folder are gone: no source, rule-case or golden case names them, and the rule cases cover the superseded item instead. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run test:integration`

## Notes
D11. Golden: `bun run golden -- --update` drops the old item, `bun run golden` harvests T7a/T7d cases.
Person's decision at the first slice gate (D11, B27 amended): only a takeover without a release supersedes the old copy; after a clean `story handoff` the copy, already on the ref, is removed quietly. Whether a clean `watch` exit or `story close` counts the same is not named; they push the record exactly as handoff does (B15), so treat them alike unless the person says otherwise.
RULES T7a and R2.3 still read as if any local copy is superseded; they must be amended to the person's decision (gh-195/18 does it, or the person through refinement if they prefer).
