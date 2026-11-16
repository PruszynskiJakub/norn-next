---
id: gh-345
slug: every-route-back-needs-a-hand-written
provider: gh
number: 345
url: https://github.com/PruszynskiJakub/norn-next/issues/345
title: Every route back needs a hand-written named counter
assignee: PruszynskiJakub
labels:
  - norn
  - norn:kind:feature
  - norn:priority:medium
  - norn:risk:medium
workflow: refinement
status: active
intake_at: 2026-11-16T18:42:38.834Z
body_hash: 3f838c286b80dba0453f1d471d2c2076536a71ad272f588e78bbd5ade8d2e576
refined_body_hash: 3f838c286b80dba0453f1d471d2c2076536a71ad272f588e78bbd5ade8d2e576
---

# Every route back needs a hand-written named counter

## Problem Statement

Whoever writes or edits a norn workflow has to bound every loop by hand. Every route back has to name a counter, every counter has to be declared under `counters:` with a max, and a loop with no counter on any of its edges is refused at load (`cycle without a counter`). The shipped `quick` workflow declares 8 counters and `story` declares 10, each declared far from the edge it bounds. Yet the maxima simply follow the kind of edge: a failed check gets 5, an agent sending work back 3, a gate's reject 2, a conflict 2 (reset when the update succeeds), `stale` 10. So the author writes the same boilerplate over and over, and anyone reading the file has to jump between an edge and the block at the bottom to learn its bound. Shared files make this worse: a counter used inside `shared/base-update.yaml` is declared in every workflow that brings the file in.

Whoever resumes a stuck story needs the opposite: the counter that ran out still has a name they can see in the brief, in `norn status` and in the Unblock item, and can pass to `norn run rerun --reset`.

## Solution

An edge with no `counter:` gets a counter derived from the kind of edge, named after the edge it counts, `<step>.<outcome>` (for example `review.changes_requested`). It has a default max, and a default reset for a conflict. The author writes nothing unless the default is wrong, and then writes `max: <n>` on the edge itself: `fail: { to: implement, max: 3 }`. `counter: <name>` and the `counters:` block keep working for one counter shared by several edges and for a custom `reset_on`.

Default bounds by kind of edge:

| Edge | Default max | Resets |
|---|---|---|
| a check's `fail`, or an outcome its `exits:` map names for an exit code, other than `stale` | 5 | never |
| a gate's `reject` | 2 | never |
| a `conflict` | 2 | on any other outcome of the same step |
| `stale`, on any step kind | 10 | never |
| an agent outcome other than `done`, `pass` or `approve` that lies on a loop the rows above leave uncounted | 3 | never |

A route that leaves a shared file through a named exit gets one counter, `<use step>.<exit>` (for example `ship.stale`), shared by every inner edge that leaves through that exit. Its default comes from the kind of those inner edges. A loop still uncounted after derivation is refused as today.

A derived counter shows up under its name wherever a counter does: `state.json`, the exhausted park and its Unblock item, the brief's last-round warning, `norn status`, `norn story view` and the status watch. `norn run rerun --reset` accepts it too. The shipped workflows drop every counter whose max and reset match the defaults. Loaded, each one has the same bound on the same edges as today.

## User Stories

1. As a workflow author, I want a check's `fail` edge that leads back to an earlier step to be bounded at 5 laps without my writing a counter, so that `fail: implement` is all I write.
2. As a workflow author, I want an outcome a check names through its `exits:` map (other than `stale`) to be bounded at 5 laps and never reset, like the check's `fail`, so that a check failing in a named way gets the same budget.
3. As a workflow author, I want a gate's `reject` edge to be bounded at 2 without a counter, so that a person is not asked more than twice on one loop by default.
4. As a workflow author, I want a `conflict` edge to be bounded at 2 and reset to 0 whenever the same step ends in any other outcome, so that only repeated conflicts on one base move count.
5. As a workflow author, I want a `stale` edge on any kind of step to be bounded at 10 without a counter, so that re-entries caused from outside (a sibling merging) get a loose bound.
6. As a workflow author, I want an agent outcome other than `done`, `pass` or `approve` that lies on a loop the other kinds leave uncounted to be bounded at 3, so that a review sending work back (`review.changes_requested → implement`) needs nothing written.
7. As a workflow author, I want an agent outcome that lies on no uncounted loop, and every `done`, `pass` or `approve` edge, to get no derived counter, so that forward progress is never counted.
8. As a workflow author, I want each derived counter named `<step>.<outcome>` after the edge it counts, the same spelling `reset_on` uses for an edge, so that I can tell which edge a counter bounds from its name alone.
9. As a workflow author, I want `max: <n>` on an edge to replace its default max while keeping its derived name and reset, so that `fail: { to: implement, max: 3 }` changes only the bound.
10. As a workflow author, I want `max: <n>` on an edge that would derive no counter (for example a gate's `approve` or an agent's `done` that leads back) to count that edge as `<step>.<outcome>` with that max and no reset, so that I can bound any edge I choose.
11. As a workflow author who writes both `max:` and `counter:` on one edge, I want the load refused with a message saying a named counter's max goes under `counters:`, so that one edge never has two bounds.
12. As a workflow author who writes `max:` on an edge to `$done` or `$stuck`, I want the load refused with a message naming the edge and saying there is no loop to bound, so that a meaningless bound is not silently kept.
13. As a workflow author, I want `counter: <name>` and the `counters:` block to keep working as today, both for one counter shared by several edges and for a custom `reset_on`, so that the shipped `qa_loop` (a check's `fail` and a gate's `reject` sharing one budget of 2) keeps working.
14. As a workflow author, I want an edge with `counter:` to get no derived counter, so that a named counter is never counted twice.
15. As a workflow author, I want a name declared under `counters:` to stay dotless as today, and `counter: review.changes_requested` refused because no counter by that name is declared, so that a name I declare can never clash with a derived one.
16. As a workflow author, I want a route that leaves a shared file through a named exit to be counted by one counter `<use step>.<exit>` (for example `ship.stale`, `base-update.broken`), shared by every inner edge that leaves through that exit, so that the three test failures of the base update share one budget as they do today.
17. As a workflow author, I want a shared exit's default to come from the kind of the inner edges that feed it (a gate's `reject` gives 2, a check's `fail` 5, `stale` 10), and `max:` on the use step's route to override it, so that `reject: implement` on the `ship` step needs nothing written.
18. As a workflow author whose shared exit is fed by edges of different kinds (for example a check's `fail` and a gate's `reject`), I want the load refused unless the use step's route gives `max:`, with a message naming the exit and the kinds that feed it, so that the bound is explicit where the default is ambiguous.
19. As a workflow author, I want a loop that is still uncounted after derivation to be refused as today, with the `cycle without a counter` message naming its edges, so that every loop stays bounded.
20. As a workflow author, I want `norn doctor` to pass a workflow that leaves every default unwritten, and to report each new refusal (`max:` with `counter:`, `max:` on an edge to `$done`/`$stuck`, a mixed-kind exit without `max:`) with the edge or exit it is about, so that I learn what to fix without running a unit.
21. As a person resuming a stuck story, I want a derived counter that ran out to be named `<step>.<outcome>` (or `<use step>.<exit>`) in the exhausted park and its Unblock item, together with its edge and target as today, so that I know which loop gave up.
22. As an agent in a step, I want the brief's last-round warning to name a derived counter that is one lap from its max (`Last round on review.changes_requested (2/3)`), so that I know a send-back would make the unit stuck.
23. As a person reading `norn status`, `norn story view` or the status watch, I want a derived counter listed under its name with its value and its derived or overridden max (`review.changes_requested 1/3`), so that I see how close a loop is to its bound.
24. As a person unsticking a unit, I want `norn run rerun <unit> --reset review.changes_requested` to reset that derived counter to 0, so that I can give one loop more laps without editing the workflow.
25. As a person who passes `--reset` a name that the unit's pinned workflow neither declares nor derives, I want the rerun refused as today with the counters it does have, so that a typo does not pass silently.
26. As a `--json` reader of `state.json`, the brief or the status output, I want a derived counter's dotted name to validate wherever a counter name is stored, so that a unit with a derived counter is never marked corrupt by the norn that wrote it.
27. As a maintainer of the shipped workflows, I want `quick`, `story`, `slice`, `refinement` (and this repo's `release`) to drop every counter whose max and reset match the defaults and keep the rest as `max:` overrides or shared names (for example `ship.ci-failed` with `max: 3`, `resolution-review.changes_requested` with `max: 2`, `slice.reject` with `max: 3`, `qa_loop` kept as a shared name), so that the files hold only what differs from the defaults.
28. As a maintainer, I want every shipped workflow, once loaded, to keep the same set of (edge, max, edges sharing a counter, reset edges) as today, apart from counter names, so that no decision changes. The one stated exception is `slice`'s `merge.conflict`, whose derived counter also resets on `merge.done`. That edge goes to `$done`, so no lap is ever counted after it, and a test shows that the bound on every run is the same as with today's `conflict_loop`.
29. As a maintainer, I want the golden cases updated for the counter names only, so that their diff shows no changed decision.
30. As a user of a repo whose workflows were installed before this change, I want those workflows, with their `counter:` names and `counters:` block, to load and run exactly as before, so that upgrading norn needs no workflow edit.
31. As a person with a unit already running, I want it to keep its pinned workflow and its counters under their old names after the upgrade, so that a rerun or `--reset` with the old name still works mid-round.
32. As a reader of the docs, I want the workflow docs (recipes and concepts) to give the table of defaults, the `<step>.<outcome>` and `<use step>.<exit>` naming rule, `max:` on an edge, and when `counter:`/`counters:` is still needed, and the glossary's counter entry to say a counter is named or derived from its edge, so that I can write a workflow without reading the source.

## Out of Scope

- Listing a workflow's derived counters before a unit runs (for example in `norn doctor`). The docs carry the table and the naming rule, a refusal names its edge, and a listing belongs with the `norn-workflow` skill (#341).
- A custom `reset_on` for a derived counter. That stays the `counters:` block's job.
- Renaming counters in units already running. They keep their pinned workflow.
- Changing the bounds of any shipped workflow. Only how they are written changes.
- Simplifying the base update's `resolved` path (design record section 5). It's a separate workflow edit.
- Nudges and retries. They have their own limits and are not loop counters.

## Further Notes

- **One-way stored format, and a merge danger.** A dotted counter name becomes valid wherever a counter name is stored (`state.json` counters, the exhausted park). An older norn reading a `state.json` that holds a dotted counter fails validation and marks the unit corrupt. The format can't be taken back once units hold such names, and the PR's merge danger must say so. Names declared under `counters:` stay dotless, so the two kinds never clash.
- The design record: https://gist.github.com/PruszynskiJakub/0dcf9042145fe9c46f32bd9b8b94fb19. Its `quick.yaml` shows the intended shape (`fail: { to: implement, max: 3 }`, a bare `reject: implement`, a bare `stale: update` on the `ship` step). Section 6 records that the shared-step flattening keeps every edge and counter budget of `quick` and `story`.
- Shared steps (#342, done in #352) are in place, so the three test failures of the base update already leave through one exit.

## Open questions

None.
