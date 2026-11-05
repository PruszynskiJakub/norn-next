## Summary

A step agent in a unit worktree (`NORN_RUN` set) can no longer decide a gate with a plain `norn story approve` / `norn story reject`: it is refused (exit 3, `gate_by_agent`) instead of being recorded as the person's decision (`by: "human"`). The person, and delegated supervision from the main checkout, are unchanged (§6 gate row, SK3).

```diff
 decideGate(ctx, args, kind)
   d = delegation(ctx, args, verb)        // --delegated in a unit → delegated_in_unit (as before)
+  if ctx.unit and env.NORN_RUN
+    refuse "gate_by_agent", do_instead: "gates are decided by the person,
+            or by a supervisor in the main checkout (<root>); report this step's outcome instead"
   …record the approve / reject as before
```

The check sits in `story approve` / `story reject` only, not in the shared `delegation()`, so `story answer`, `run rerun` and `story edit` (not in this issue) behave as before.

## Evidence

No QA run in this `quick` round; the evidence is the integration tests in `packages/cli/test/integration/delegated.test.ts`, red before the fix, green after (unit tier and typecheck green too).

- **W1** an agent's approve / reject in a unit worktree is refused
  **Before:** `story approve gh-1` with `NORN_RUN` set from the unit worktree was accepted, receipt `by: "human"`.
  **After:** test "gh-224: a step agent's plain approve or reject in a unit worktree is refused…": for `story approve gh-1`, `story approve` and `story reject gh-1 --reason …` with `NORN_RUN` set → exit 3, code `gate_by_agent`, `do_instead` names the main checkout; the unit is still parked at its gate. Failed before the fix (the approve went through), passes now.
- **W2** delegated supervision from the main checkout unchanged
  **Before:** `--delegated` from the main checkout records a delegated decision.
  **After:** the existing "delegated decisions are recorded apart from the person's (B21, B22, B34)" tests still pass.
- **W3** a person in a unit worktree without `NORN_RUN` unchanged
  **Before:** not refused as an agent.
  **After:** test "gh-224: a person in a unit worktree (no NORN_RUN) is not refused as an agent": `story approve gh-2` (parked at an ask) gets past the agent check to the usual `not_at_gate` refusal.

## Merge danger

**Door:** two-way: one refusal in one command, no persisted format or data change; a revert restores the old behaviour.

**Blast radius:** step agents: an agent (or a script) that ran `story approve` / `reject` inside a unit worktree with `NORN_RUN` set now gets exit 3; a person who sets `NORN_RUN` by hand in a worktree would be refused too and can decide from the main checkout.
