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
  - norn:wf:story
workflow: story
status: active
intake_at: 2026-11-16T18:42:38.834Z
body_hash: 3f838c286b80dba0453f1d471d2c2076536a71ad272f588e78bbd5ade8d2e576
refined_body_hash: 3f838c286b80dba0453f1d471d2c2076536a71ad272f588e78bbd5ade8d2e576
criteria:
  - { id: 01.AC1, verifier: test }
  - { id: 01.AC2, verifier: test }
  - { id: 01.AC3, verifier: test }
  - { id: 02.AC1, verifier: test }
  - { id: 02.AC2, verifier: test }
  - { id: 02.AC3, verifier: test }
  - { id: 02.AC4, verifier: test }
  - { id: 02.AC5, verifier: test }
  - { id: 02.AC6, verifier: test }
  - { id: 02.AC7, verifier: test }
  - { id: 02.AC8, verifier: test }
  - { id: 02.AC9, verifier: test }
  - { id: 02.AC10, verifier: test }
  - { id: 02.AC11, verifier: test }
  - { id: 02.AC12, verifier: agent }
  - { id: 03.AC1, verifier: test }
  - { id: 03.AC2, verifier: test }
  - { id: 03.AC3, verifier: test }
  - { id: 03.AC4, verifier: test }
  - { id: 03.AC5, verifier: agent }
  - { id: 04.AC1, verifier: test }
  - { id: 04.AC2, verifier: test }
  - { id: 04.AC3, verifier: test }
  - { id: 04.AC4, verifier: test }
  - { id: 04.AC5, verifier: test }
  - { id: 04.AC6, verifier: test }
  - { id: 04.AC7, verifier: test }
  - { id: 05.AC1, verifier: test }
  - { id: 05.AC2, verifier: test }
  - { id: 05.AC3, verifier: test }
  - { id: 05.AC4, verifier: agent }
  - { id: 06.AC1, verifier: agent }
  - { id: 06.AC2, verifier: test }
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
27. As a maintainer of the shipped workflows, I want `quick`, `story`, `slice`, `refinement` (and this repo's `release`) to drop every counter whose max and reset match the defaults and keep the rest as `max:` overrides or shared names (for example `ship.ci-failed` with `max: 3`, `resolution-review.changes_requested` with `max: 2`, `approve-slices.reject` with `max: 3`, `qa_loop` kept as a shared name, and `stale_loop` kept as a shared name wherever more than one edge shares it), so that the files hold only what differs from the defaults.
28. As a maintainer, I want every shipped workflow, once loaded, to keep the same set of (edge, max, edges sharing a counter, reset edges) as today, apart from counter names, so that no decision changes. The one stated exception is `slice`'s `integrate.conflict`, whose derived counter also resets on `integrate.done`. That edge goes to `$done`, so no lap is ever counted after it, and a test shows that the bound on every run is the same as with today's `conflict_loop`.
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

## Plan

### Seams

- **S1 The store's workflow loader, through `loadWorkflowText` (and `loadWorkflows`), followed by core's `validateWorkflowDefinition` the way `repoWorkflows` runs them for doctor and the tick.** Observes everything an author writes and what gets pinned: the derived name, max and reset per kind of edge, `max:` overrides, the new refusals, shared-exit counters, an uncounted loop still refused, an old workflow keeping its pin byte for byte, and every shipped workflow keeping today's counting.
  Prior art: the store's shared-workflows tests (`use: brings in a shared file's steps`, `shared files and the loaded text`), core's `validateWorkflowDefinition` tests, and the cli's `workflow templates` tests over the bundled files.
- **S2 Core's classify/advance and the brief, through the apply functions and the brief builder, fed a pinned workflow that holds derived counters.** Observes a derived counter counting its edge, its reset, the exhausted park naming it with its edge and target, the brief's last-round warning, and that `integrate.conflict` gives the same bound as today's `conflict_loop`.
  Prior art: core's apply and brief tests, and the fixtures in core's test folder.
- **S3 The schema validators, through `validate`/`assertValid` on `state`, receipts and `workflow`.** Observes that a dotted name validates where a counter name is stored, while the as-written forms (`workflow-source`, `workflow-shared`) still refuse one under `counters:` and `counter:`.
  Prior art: the schema package's state, records and workflow tests.
- **S4 The CLI, through the cli harness.** Observes `norn doctor` reporting each new refusal, `norn status` and `norn story view` listing `review.changes_requested 1/3`, `norn run rerun --reset` with a derived name, an old name in a unit pinned before the upgrade, and an unknown name refused with the counters the unit has.
  Prior art: the run-rerun-check and shared-workflows integration tests in the cli, the non-holder-views test, and the view package's integration test.
- Golden cases (`bun run golden`) cover the decisions; docs are covered by the docs lint in the unit tier and by review.

### Coverage

| User story | Seam | Test kind | Notes |
|---|---|---|---|
| 1 a check's fail is bounded at 5 | S1 | unit | store tier |
| 2 an outcome a check's exits map names (other than stale): 5, never reset | S1 | unit | |
| 3 a gate's reject: 2 | S1 | unit | |
| 4 conflict: 2, reset on every other outcome of the same step | S1 | unit | reset_on lists the step's other declared outcomes |
| 5 stale on any step kind: 10 | S1 | unit | check exits-named `stale`, gate, merge |
| 6 an agent send-back on an uncounted loop: 3 | S1 | unit | |
| 7 forward edges and agent outcomes on no uncounted loop: no counter | S1 | unit | |
| 8 the name is `<step>.<outcome>` | S1 | unit | |
| 9 `max:` replaces the default, keeping name and reset | S1 | unit | |
| 10 `max:` on an edge that derives nothing counts it, no reset | S1 | unit | |
| 11 `max:` together with `counter:` refused | S1 | unit | doctor's report under story 20 |
| 12 `max:` on an edge to `$done`/`$stuck` refused | S1 | unit | |
| 13 `counter:` and `counters:` work as today | S1 | unit | qa_loop shape |
| 14 an edge with `counter:` derives nothing | S1 | unit | |
| 15 declared names stay dotless; `counter: review.changes_requested` refused as undeclared | S1 | unit | schema side under S3 |
| 16 a shared exit counted once, as `<use step>.<exit>` | S1 | unit | base-update.broken shape |
| 17 a shared exit's default comes from its feeders' kind; `max:` on the use route overrides it | S1 | unit | |
| 18 mixed deriving kinds behind one exit refused without `max:` | S1 | unit | message names the exit and the kinds |
| 19 a loop still uncounted is refused as today | S1 | unit | |
| 20 doctor passes defaults and reports each refusal with its edge or exit | S4 | integration | |
| 21 an exhausted derived counter is named in the park and its Unblock item | S2 | unit | |
| 22 the last-round warning names a derived counter | S2 | unit | |
| 23 status, story view and the watch list a derived counter with its max | S4 | integration | the watch shares the view's counter formatting |
| 24 `rerun --reset <derived>` resets it | S4 | integration | |
| 25 `--reset` with an unknown name refused, listing the unit's counters | S4 | integration | |
| 26 dotted names validate in state, park, receipts and the pinned workflow | S3 | unit | |
| 27 the shipped files hold only what differs from the defaults | S1 | unit | the counter-count assertion in `workflow templates` changes; review checks each file |
| 28 every shipped workflow keeps its counting; integrate.conflict is the exception | S1 | unit | the integrate.conflict bound itself under S2 |
| 29 golden cases change in counter names only | golden | unit | `bun run golden -- --update`, the diff reviewed |
| 30 workflows installed before this change load and run as before | S1 | unit | today's bundled and repo texts load with the same source and hash |
| 31 a running unit keeps its pin and old counter names | S4 | integration | rerun `--reset ready_loop` on a unit pinned with explicit counters |
| 32 docs give the defaults table, naming, `max:` and when `counters:` is still needed | docs | review | the docs lint covers the glossary terms |

### Prefactoring

1. The flattener hands back the flat document plus where its routes left a shared file, before it writes the YAML text: for each flat edge that left through an exit, the `<use step>.<exit>` it left by, and that use route's `counter:`/`max:`. The pinned text and its hash don't change. Without this, stories 16–18 have nothing to derive from: once the workflow is flat, which exit an edge took is gone.

### Implementation decisions

- D1 **Derive at load, into the pin.** `loadWorkflowText` derives right after flattening and before pinning: the edge gets `counter: <name>`, and `counters:` gets `<name>: { max, reset_on? }`. Everything that reads counters today (`enterStep`'s initial counters, the advance and exhausted park in apply, the brief's at_limit and Rework, `run rerun --reset`, the view's counter list) keeps reading the pinned workflow, unchanged. A pin is read as written and never derived again, so a unit started before the upgrade keeps its counters and their names (story 31). This beat deriving on every read in core, which needs the shared-exit information in the pin and changes every reader.
- D2 **A file that derives nothing keeps its pin byte for byte.** Only a file that derives at least one counter, or writes `max:`, is pinned as its derived text, written out the way the flattener writes one today (so its hash changes once). A workflow with every route counted by hand keeps its source and hash (story 30).
- D3 **The pure derivation lives in core.** It is one function over the flat workflow in model form plus the exit information from the prefactor. It returns, per edge, the counter name to write, the counter specs to add, and the refusals. The store writes the result into the text. Edges are keyed the same in the file wording and the model wording, so the edits apply to the file's text directly.
- D4 **Rules, exactly:**
  - Only an edge whose target is a step derives anything. An edge with `counter:` derives nothing.
  - A check's `fail`, or an outcome its `exits:` names other than `stale`: 5, no reset. A gate's `reject`: 2. Any `conflict`: 2, `reset_on` = every other outcome declared on that step. `stale` on any step: 10.
  - An agent outcome other than `done`, `pass` or `approve`: 3, only when the edge lies on an elementary cycle of the edges still uncounted after the rows above and the named counters (reusing `elementaryCycles`).
  - Rows 1–4 count such an edge even when it lies on no loop (the person's decision).
  - `max:` on a deriving edge replaces only the max. `max:` on a non-deriving edge counts it as `<step>.<outcome>` with that max and no reset.
- D5 **Shared exits.** The flat edges that left through `<use step>.<exit>`, with no `counter:` on that use route, are the exit's feeders. The ones that derive a counter share one counter `<use step>.<exit>`; feeders that derive nothing stay uncounted (the person's decision). If those deriving feeders all have one kind, that kind's default applies; a conflict's `reset_on` is the union of every feeder step's other outcomes. If they have different kinds, the load is refused unless the use route gives `max:`; with `max:` they share it, with no reset. Agent feeders derive when any of them lies on an uncounted loop. `max:` on a use route with no deriving feeder counts every feeder. A use route to `$done`/`$stuck` derives nothing. Names never clash: the flattener already refuses an included step named like its use step.
- D6 **Schema.** A new stored counter name, `IDENT` or `IDENT.IDENT`, goes on `state.counters`, the park's `counter.name`, a receipt's `reset` list, and the loaded `workflow`'s `counters:` keys and edge `counter:`. The as-written forms (`workflow-source`, `workflow-shared`, use routes) keep the dotless `CounterName` and gain `max: PosInt` on an edge route (not on `{ exit: }`); the loaded `workflow` has no `max`. Then `bun run schema:emit`. This is one-way: an older norn marks a unit corrupt if its state.json, receipts or **pinned workflow.yaml** hold a dotted name. That goes in the PR's merge danger.
- D7 **Refusals are loader errors** (a file error with a JSON pointer to the edge or the use route), reported by doctor like any loader error and prefixed with the shared file when the edge came from one. Messages:
  - `max:` with `counter:`: "`<step>.<outcome>` sets both max and counter: a named counter's max goes under counters".
  - `max:` to an end: "`<step>.<outcome>` → `$done` sets max, but there is no loop to bound".
  - A mixed exit: "exit `<exit>` of `<use step>` is fed by edges of different kinds (check fail: `test.fail`; gate reject: `ready.reject`): give max: on `<use step>`'s route".
  - An uncounted loop stays `uncounted_cycle`, from `validateWorkflowDefinition`.
- D8 **Shipped workflows, in `packages/cli/assets/workflows/` and `.agents/workflows/` both.** Every counter whose max and reset match the defaults is dropped. Kept or overridden:
  - `ship`'s CI-failed exit gets `max: 3` (`ci-failed` shipped, `failed` in this repo's copy).
  - `resolution-review.changes_requested` gets `max: 2`, in base-update.yaml.
  - `approve-slices.reject` gets `max: 3`.
  - `qa_loop` stays a shared name.
  - `stale_loop` stays a shared name wherever it spans more than one edge: shipped story, release, and this repo's quick and story. Shipped quick derives `ship.stale`.
  - slice drops `conflict_loop`; `integrate.conflict` now also resets on `integrate.done`, the stated exception.
- D9 **The invariant test** pins a table per shipped workflow (the bundled ones and this repo's, release included), taken from today's files before any edit. The table holds, per counted edge, its max and reset edges, plus the groups of edges sharing a counter, all without counter names. The test loads the edited files and compares. `integrate.conflict`'s added reset is the only listed difference. S2 proves its bound: two conflicts, a third parks exhausted, and `integrate.done` ends at `$done`, as today.
- D10 **No code change in run-rerun, the brief, apply or the view.** They see derived counters through the pin; S2 and S4 tests prove it.
- D11 **Docs.** The workflow recipes and concepts get the defaults table, both naming rules, `max:`, and when `counter:`/`counters:` is still needed; the glossary's counter entry says a counter is named or derived from its edge; then `bun run docs:emit`.

### Testing decisions

A good test writes a workflow the way an author does (YAML text, plus shared texts through the reader) and checks what is pinned and refused. Or it drives a unit through the harness and reads what a person or agent sees. It never calls the derivation function or reads flattener internals. Workflow texts come from the shipped files or inline fixtures named after the shape they test; ref names and shapes come from the code. Nothing is faked except what the harness already fakes at system boundaries (the forge, the clock). The golden diff and the invariant table are pinned outputs: they change only together with the behaviour this spec names.

### Risks

- **The agent row and the shared-exit kinds could miscount a shipped workflow.** That is the most likely failure. The invariant table is written first, from today's files, so every later change is checked against it.
- **Another path pins or parses a workflow file without going through `loadWorkflowText`.** Such a path would refuse `max:` as a schema error, or pin an underived text. The slice that adds `max:` lists every caller of `parseWorkflowText` and the flattener (record-ref restart, story edit, upgrade wording) and routes each file read through the loader.
- **The format can't be taken back** (dotted names in state.json, receipts and workflow.yaml), and the released `norn` running hooks next to a newer pin hits it. That goes in the merge danger; nothing to test.
- **The status line could get longer.** The view lists every counter with a max while a unit runs. A shipped workflow gets about as many derived counters as it declared before, so expect a similar length; S4 checks the line.
