---
id: gh-195/14
title: An old holder's record is set aside as superseded
depends_on: [gh-195/11]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
---

## Goal
When another machine took a story over, the old holder's next tick moves its local record aside as superseded, never pushes it, and shows one Check item; `tidy` deletes it after `trace.retain`. This replaces "local work not in the record" items and `orphaned/` folders.

## Scope
Behaviour: B27. Seams: S1. Out: merging a superseded record into the new one (out of scope).

## Acceptance
- AC1 (B27) Given clone A held gh-9 and clone B took it over after expiry, when A's next tick runs, then A's `runs/gh-9/` is moved to `<machine dir>/superseded/gh-9-<ulid>/`, nothing is pushed for it, and `norn status` on A shows "your record of gh-9 was superseded when <new holder> took it over (last local receipt <NNNN-kind>)". — verifier: test
- AC2 (B27) Given that superseded copy, when `norn tidy` runs before and after it is older than `trace.retain`, then it is kept the first time and deleted the second, and the Check item goes with it. — verifier: test
- AC3 (B27) The `unpushed_runs` fact, its "local work … is not in the record" Check item and the `orphaned/` folder are gone: no source, rule-case or golden case names them, and the rule cases cover the superseded item instead. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run test:integration`

## Notes
D11. Golden: `bun run golden -- --update` drops the old item, `bun run golden` harvests T7a/T7d cases.
Ambiguity for the person: after a clean `story handoff` from A, A's local copy equals the ref, yet D11 as written ("per story held by another heartbeat, a local record") would set it aside with a Check item too. The natural reading is that a release clears or marks the local copy so only a takeover without a release supersedes it; confirm before building.
