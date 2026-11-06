## Summary

When a counter runs out (W4), the way out norn offers now goes to the exhausted edge's target with the counter reset, not a plain rerun of the same step. A plain `norn run rerun` that leaves the counter at its max still runs, and its result warns that the same outcome will end stuck again.

```diff
 take(outcome) on a counted edge
   if counter + 1 > max
-    park exhausted { reason }
+    park exhausted { reason, counter: { name, max, outcome, to } }   # ParkInfo.counter, state.json

 way out (inbox Unblock, nextCommand, cockpit `u`)
-  norn run rerun <unit>
+  if park.counter: norn run rerun <unit> --step <to> --reset <counter>   # only --reset when <to> is $done/$stuck
+  else:            norn run rerun <unit>

 norn run rerun <unit> [--reset …]
+  if park.counter and counter not in --reset: result.warning = "<counter> ran out … To act on <outcome>: <way out>"
```

`reason` is unchanged and never parsed. Units that went stuck before this change have no `counter` field and keep the plain rerun. Nudges, retries, agent `stuck` reports and every other stuck reason keep it too.

## Evidence

This quick round has no QA step. The proof is the tests below. Each one is new and could not pass before, because neither `park.counter` nor `rerunWarning` existed. The unit tier, the type check and the integration test file pass on the branch.

- **Wanted 1**: the way out of a run-out counter is the outcome's target with the counter reset
  **Before:** the inbox showed `norn run rerun gh-196`, which restarted `review` on unchanged code. That cost two more review sessions (gh-196, receipts 0033 and 0037).
  **After:** `packages/cli/test/integration/run-rerun-cancel.test.ts` › "the way out is the edge's target with the counter reset; …" runs the issue's repro: a gate rejected 3 times past `loop` max 2.
  `state.park == { kind: exhausted, counter: { name: loop, max: 2, outcome: reject, to: implement } }`
  `norn status --json` › unblock[gh-5].command `== "norn run rerun gh-5 --step implement --reset loop"`
  Unit tests: `nextCommand` → `--step implement --reset review_loop`; a `$stuck` target → `--reset loop` only (`handoff-inbox.test.ts`). Cockpit `u` keeps `--step`/`--reset` in its argv (`cockpit.test.ts`).
- **Wanted 2**: a plain rerun warns that it will end the same way
  **Before:** no warning.
  **After:** the same integration test runs `norn run rerun gh-5`: exit 0, `warning == "loop ran out (2/2) at review.reject and is not reset: if review ends reject again, the unit is stuck again. To act on reject: norn run rerun gh-5 --step implement --reset loop"`. `rerunWarning` returns null when the counter is in `--reset` and when the park has no `counter` (`handoff-inbox.test.ts`).
  Not built: "unchanged code" is not measured. A rerun that does not reset the counter keeps the edge closed, so the same outcome ends stuck again whatever the code. The warning is therefore given every time, not only when the code is unchanged.
- **Park records counter, max, outcome and target (W4)**: `apply.test.ts` › transitions (W3, W4): `park.counter == { review_loop, 3, changes_requested, implement }`.

## Merge danger

**Door:** two-way, with one caveat. A revert removes the new way out and the warning. But a `state.json` that this version wrote with `park.counter` fails validation in an older norn (`ParkInfo` allows no extra properties), and the older norn would mark that unit `corrupt` (S2). This only matters for a unit stuck on a counter when someone downgrades.

**Blast radius:** stuck units. This change affects only units parked `exhausted` on a counted edge: their inbox command, `nextCommand`, cockpit `u`, and a new optional `warning` field in `run rerun`'s JSON. `run rerun` refuses nothing new. Known gap: `docs/recipes.md:40` still says a counter at its max shows the plain `norn run rerun <unit>` (review note, minor).
