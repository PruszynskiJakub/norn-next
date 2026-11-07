## Summary

Before a fresh agent session starts (`start_run`, `retry_fresh`), norn now stops what an earlier session left listening on the unit's slot ports from its worktree, using the same port + cwd rule as before a check. What it stopped goes into the action's result detail (`stopped_listeners`), which the tick trace keeps.

```diff
 launchSession(unit, launch, fresh)
   take agent lease
   env = .env.norn + launch.env
+  if fresh and slotPorts(PORT_BASE)
+    stopped = stopStrayListeners(worktree, ports)   # same rule as the check runner
   launch agent
-  return { session, lease }
+  return { session, lease, stopped }               # → detail.stopped_listeners
```

A resume (an answer through `apply_receipts`, a `nudge`) keeps the same session, so its servers are left running. `slotPorts(PORT_BASE)` moved into `strays.ts` and the check runner uses it too.

## Evidence

No QA ran; the entries below are tests (the test check passed, along with `bun run test` and `bun run typecheck`).

- **Stop stray listeners before launching an agent step, and record them**
  **Before:** only a `check` stopped strays; a server left by `implement#3` on port 4021 made `implement#4` fail.
  **After:** `agent-strays.test.ts` › "stops a listener the worktree left on its slot ports, and the trace records it": a server on a slot port, started from the worktree → `start_run` detail has `stopped_listeners: [{pid, port}]` and the server has exited.
- **No change to the matching rule (port + cwd)**
  **Before / After:** the body of `stopStrayListeners` is unchanged; `strays.test.ts` and `check-run.test.ts` still pass, the check now gets its range from the shared `slotPorts`.

Not covered: no test runs the `retry_fresh` path, which goes through the same `launchSession` with `fresh: true` (review accepted this). A run started by `norn brief` in manual mode has no launch, so nothing is stopped there.

## Merge danger

**Door:** two-way: code only, no format or data change; a revert brings back the check-only stop.

**Blast radius:** agent launches: a fresh launch now kills processes listening on the slot's ports whose cwd is inside the worktree. A person's own dev server started from that worktree on a slot port would be stopped, as a check already does. Without `lsof` nothing is stopped.
