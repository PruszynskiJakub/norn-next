---
id: gh-345/04
title: Derived counters in the park, brief, status and rerun
depends_on: [gh-345/02]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
---

## Goal
A person or agent sees a derived counter under its name everywhere a counter appears today: the exhausted park and its Unblock item, the brief's last-round warning, `norn status`, `norn story view` and the watch. `norn run rerun --reset` takes the name too. Units pinned before the upgrade keep their old names.

## Scope
User stories: an exhausted derived counter named in the park and Unblock item; the last-round warning naming it; status, story view and the watch listing it with its max; `rerun --reset` with a derived name; an unknown name refused with the unit's counters; a running unit keeping its pin and old names. Also the `integrate.conflict` bound itself. Seams: S2, S4. Out: changing apply, the brief, rerun or the view (D10 says none is needed; fix only what a test proves broken).

## Acceptance
- AC1 Given a unit whose pinned workflow derives `review.changes_requested` (max 3), when review sends work back a fourth time, then the unit parks exhausted naming `review.changes_requested` with its edge and target, and the Unblock item names it the same way. — verifier: test
- AC2 Given that counter at 2 of 3, when the brief for the next implement step is built, then it warns `Last round on review.changes_requested (2/3)`. — verifier: test
- AC3 Given a running unit with `review.changes_requested` at 1, when a person runs `norn status` or `norn story view`, then the counter is listed as `review.changes_requested 1/3`, and the status line stays about as long as with today's named counters. — verifier: test
- AC4 Given an exhausted unit, when a person runs `norn run rerun <unit> --reset review.changes_requested`, then that counter is back to 0 and the step reruns. — verifier: test
- AC5 Given `--reset` with a name the unit's pin neither declares nor derives, when the rerun runs, then it is refused as today, listing the counters the unit has. — verifier: test
- AC6 Given a unit pinned with explicit counters (`ready_loop`) before the change, when a person runs `norn run rerun --reset ready_loop` with the new norn, then it works, and the unit's counters keep their old names. — verifier: test
- AC7 Given a slice-like workflow whose `integrate` step has `conflict: merge` derived as `integrate.conflict` (max 2, resetting on `integrate.done`), when integrate ends in conflict twice, then the third conflict parks exhausted, and `integrate.done` ends the run at `$done`, the same bound as with today's `conflict_loop`. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
D1, D9 (the `integrate.conflict` half) and D10. S2 tests feed core a pinned workflow that already holds derived counters. S4 tests drive a unit through the cli harness (read `test/support/harness.ts` first) with a workflow text that derives at load. The watch shares the view's counter formatting, so a view test covers it.
