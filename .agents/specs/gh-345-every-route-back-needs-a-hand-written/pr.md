## Summary

An edge with no `counter:` now gets a counter derived from the kind of edge it is, named `<step>.<outcome>`, or `<use step>.<exit>` for a route that leaves a shared file through an exit. A workflow author writes nothing unless the default is wrong, and then writes `max:` on the edge. The shipped workflows drop every counter that matches a default, and each one loaded still has the same bounds as today.

```diff
 # packages/cli/assets/workflows/quick.yaml (the shape; story, slice, refinement and release follow it)
   review:
     outcomes:
-      changes_requested: { to: implement, counter: review_loop }
+      changes_requested: implement            # derived: review.changes_requested, max 3
   ship:
     use: ship
     outcomes:
-      ci-failed: { to: implement, counter: ci_loop }
-      stale: { to: update, counter: stale_loop }
-counters:
-  ci_loop: { max: 3 }
-  stale_loop: { max: 10 }
-  ...                                         # 8 counters in all
+      ci-failed: { to: implement, max: 3 }     # ship.ci-failed, overrides the default 5
+      stale: update                            # ship.stale, max 10
```

```
loadWorkflowText(file)                     # store, once, before pinning
  flatten shared files, keeping each edge's <use step>.<exit>
  deriveCounters(flat)                      # core, pure
    a check's fail, or an outcome its exits map names (not stale) → 5
    a gate's reject → 2 · conflict → 2, reset on the step's other outcomes · stale → 10
    an agent send-back on a loop still uncounted → 3
    an edge with counter: → nothing; max: on an edge → overrides the max
  nothing derived → the pin is today's text, byte for byte
```

## Evidence

QA ran the dev build. It loaded crafted workflows ([derive-loaded.json](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/derive-loaded.json)), ran `norn doctor` in a throwaway repo, and drove a unit through the CLI harness ([04-run.md](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/04-run.md)). 32 of 33 criteria pass. The last one went to a person, who approved it (see the brief's last-round warning below). Full report: [report.md](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/report.md).

Before this change, the first 20 entries had one answer: every route back had to name a counter declared under `counters:` with a max, or the load was refused (`cycle without a counter`).

- **A check's `fail` is bounded at 5**
  **After:** `test.fail` pins max 5 with no reset, and no counter is written ([02.AC1](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/02.AC1.md)).
- **An outcome named in the exits map gets 5, never reset**
  **After:** `test.flaky` (exit 4) pins max 5 with no reset, and `test.stale` pins 10 ([02.AC1](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/02.AC1.md), [02.AC2](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/02.AC2.md)).
- **A gate's `reject` is bounded at 2**
  **After:** `ready.reject` pins max 2 ([02.AC2](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/02.AC2.md)).
- **A `conflict` gets 2, reset on the step's other outcomes**
  **After:** `integrate.conflict` pins max 2 with `reset_on integrate.done`. A shared conflict resets on `up.done` and `up.clean` ([02.AC2](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/02.AC2.md)).
- **`stale` on any step kind is bounded at 10**
  **After:** a gate, a check and an await-merge step each pin `*.stale` at max 10 ([02.AC2](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/02.AC2.md)).
- **An agent send-back on an uncounted loop is bounded at 3**
  **After:** `review.changes_requested` pins max 3 ([02.AC3](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/02.AC3.md)).
- **Forward progress is never counted**
  **After:** `done` and `approve` edges, and an agent outcome on no loop, get no counter ([02.AC3](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/02.AC3.md)).
- **A derived counter is named `<step>.<outcome>`**
  **After:** every derived name in [derive-loaded.json](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/derive-loaded.json) has this spelling.
- **`max:` on an edge replaces only the max**
  **After:** `fail: { to: implement, max: 3 }` pins `test.fail` max 3. A conflict with `max: 5` keeps its reset ([02.AC4](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/02.AC4.md)).
- **`max:` on an edge that derives nothing counts that edge**
  **After:** `ready.approve` with `max: 4` pins max 4 with no reset ([02.AC4](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/02.AC4.md)).
- **`max:` together with `counter:` is refused**
  **After:** "`test.fail` sets both max and counter: a named counter's max goes under counters" ([02.AC5](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/02.AC5.md)).
- **`max:` on an edge to `$done` or `$stuck` is refused**
  **After:** "`test.pass` → `$done` sets max, but there is no loop to bound" ([02.AC6](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/02.AC6.md)).
- **`counter:` and `counters:` still work**
  **After:** a fail and a reject that share one counter with a custom `reset_on` load as written and pin byte for byte ([02.AC7](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/02.AC7.md)).
- **An edge with `counter:` derives nothing**
  **After:** the same file's counters map holds only the shared counter ([02.AC7](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/02.AC7.md)).
- **Declared names stay dotless**
  **After:** `counters: test.fail` is refused as derived, never declared. `counter: review.changes_requested` is refused as undeclared ([02.AC8](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/02.AC8.md)).
- **A shared exit is counted once, as `<use step>.<exit>`**
  **After:** the three inner test failures all pin `base-update.broken` max 5 ([03.AC1](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/03.AC1.md)).
- **A shared exit's default comes from the edges that feed it**
  **After:** an exit fed by a reject gets 2. A stale exit with `max: 3` on the route gets 3. An exit to `$stuck` derives nothing ([03.AC2](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/03.AC2.md)).
- **A mixed-kind exit needs `max:`**
  **After:** "exit `back` of `verify` is fed by edges of different kinds (check fail: `test.fail`; gate reject: `ready.reject`): give max: on `verify`'s route". With `max: 4` it loads ([03.AC4](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/03.AC4.md)).
- **A loop still uncounted is refused as today**
  **After:** "cycle without a counter: implement.done → review.done → implement" ([02.AC9](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/02.AC9.md)).
- **`norn doctor` passes defaults and reports each refusal**
  **After:** all-default workflows are valid ([doctor-ok.txt](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/doctor-ok.txt)). Each refusal names its edge or exit ([doctor-bad.txt](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/doctor-bad.txt)). The `FAIL remote` there is gh auth in the sandbox and has nothing to do with this change.
- **An exhausted derived counter is named in the park and Unblock**
  **Before:** only declared names could run out.
  **After:** the 4th send-back parks on `review.changes_requested` max 3, and Unblock offers `--reset review.changes_requested` ([04.AC1](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/04.AC1.md)).
- **The brief's last-round warning names a derived counter**
  **Before:** the warning named only declared counters.
  **After:** `Last round on review.changes_requested (3/3)` appears exactly one send-back before stuck ([04.AC2](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/04.AC2.md)). The criterion's example says (2/3). The person ruled at human QA that the example was off by one and the behaviour is the intended one. The threshold is unchanged from named counters.
- **status and story view list a derived counter with its max**
  **After:** `[review.changes_requested 1/3]`, also on a machine that does not hold the unit ([04.AC3](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/04.AC3.md)). The status watch shares this formatting, but QA did not open it.
- **`rerun --reset` takes a derived name**
  **After:** exit 0, the receipt resets `[review.changes_requested]`, and the counter goes back to 0 ([04.AC4](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/04.AC4.md)).
- **An unknown `--reset` name is refused with the unit's counters**
  **After:** exit 3 `unknown_counter`, and `do_instead` lists `review.changes_requested` ([04.AC5](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/04.AC5.md)).
- **Dotted names validate wherever a counter is stored**
  **Before:** a dotted name failed the schema.
  **After:** state, park, unstick receipt and pinned workflow with dotted names are read back by status, rerun and tick without the unit going corrupt ([02.AC11](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/02.AC11.md)).
- **The shipped files hold only what differs from the defaults**
  **Before:** `quick` declared 8 counters and `story` 10.
  **After:** `quick` declares 0 and `story` 2 (`qa_loop`, `stale_loop`, both shared). Overrides are kept as `max:` ([05.AC2](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/05.AC2.md)).
- **Every shipped workflow keeps its counting**
  **After:** a counting table built without counter names is identical for every shipped file except `integrate.conflict`, which now also resets on `integrate.done` ([05.AC1](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/05.AC1.md)). Run side by side, that edge has the same bound as `conflict_loop` ([04.AC7.txt](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/04.AC7.txt)). `shipped-workflow-counting.test.ts` fails when a bound changes ([mutation](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/01.AC3-mutation.txt)).
- **Golden cases change in names only**
  **After:** "0 of 139 golden case(s) decide differently now", with no diff, because the golden cases pin their own workflows ([05.AC3](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/05.AC3-golden-update.txt)).
- **Workflows installed before this change load as before**
  **After:** all 13 of today's files, bundled and repo, pin with the same source and hash under the new loader ([01.AC1](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/01.AC1.md)).
- **A running unit keeps its pin and its old names**
  **After:** a unit pinned with `ready_loop` keeps it, and `--reset ready_loop` exits 0 ([04.AC6](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/04.AC6.md)).
- **The docs give the defaults, the naming and `max:`**
  **Before:** they did not exist.
  **After:** the recipe "Bound a loop" holds the table, both naming rules, both refusals and when `counters:` is still needed. The glossary says a counter is named or derived ([06.AC1](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/06.AC1.md)). `docs:emit` leaves no diff ([06.AC2](evidence/_story/01M7JZA5GJEH5AFXT61KD47K53/06.AC2-docs-emit.txt)).

## Merge danger

**Door:** one-way. Once a unit holds a derived counter, its `state.json`, park, receipts and pinned workflow contain dotted counter names. An older norn, after a revert or a downgrade, fails validation on them and marks that unit `corrupt`. Units pinned before the upgrade keep their old names and are not affected.

**Blast radius:** every running unit. Derivation runs at every workflow load, but the 13 workflow files that exist today pin byte for byte and every shipped bound is unchanged. The one difference is the reset `integrate.conflict` gains on `integrate.done`, and that edge goes to `$done`. Watch for this in review: a repo workflow with an uncounted agent send-back that used to be refused (`cycle without a counter`) now loads, bounded at 3.
