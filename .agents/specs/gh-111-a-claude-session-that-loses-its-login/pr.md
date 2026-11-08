## Summary

A Claude session that loses its login mid-step now parks on an implicit ask that says "agent logged out — run `/login` in the pane", instead of going `agent.silent` → nudges → `stuck` with no word about the login.

```diff
 Claude hooks installed: … Stop, SessionEnd
+                         StopFailure

 parseHookEvent(StopFailure)
+  error == authentication_failed → waiting_input "agent logged out — run `/login` in the pane"
+  any other error                → ignored (as before)

 refineHooks (Claude's pass over a run's hook facts)
+  after a logged-out StopFailure, drop that session's idle Notification (turn_end)
+  until the session's next other fact (e.g. the prompt after /login)
```

Decide is unchanged: the `waiting_input` fact takes the existing `agent.ask.implicit` path, the same as the usage-limit wait.

## Evidence

No QA ran; the entries are unit tests (the test check passed on this HEAD, 1292 pass; review approved with no findings).

- **Adapter recognises the logged-out state**
  **Before:** `StopFailure` was not installed or mapped; the turn surfaced only as the idle notification, a `turn_end` with no receipt.
  **After:** `claude.test.ts` › "claude StopFailure …": `parseHookEvent(stop-failure, error=authentication_failed)` → `{event: waiting_input, message: "agent logged out — run /login in the pane"}`; other errors → `null`; "claude hooks install" now lists `StopFailure`. The integration test "installed hook commands use event names the hook accepts" now fires `StopFailure` with `error: authentication_failed` (an empty payload maps to no fact, which failed CI on the first push).
- **Treated like the usage-limit wait, no nudges spent**
  **Before:** `agent.silent` → nudge → … → `stuck`.
  **After:** `decide.test.ts` › "a logged-out session parks on an implicit ask…": parks on `agent.ask.implicit` with that reason, still `unit.parked.ask` 30 min later, `nudges_used` 0. `claude.test.ts` › "the idle notification after a failed login is dropped…": `refine([prompt, loggedOut, idle, idle]) == [prompt, loggedOut]` (without this, review#1 found the idle notification undid the park ~60 s later).
- **After the login, the run continues in the same session**
  **Before:** did not exist (the unit was `stuck`).
  **After:** same decide test: a later `UserPromptSubmit` → `agent.ask.implicit.resolved`, `status: running`, `nudges_used` 0.

Not proven: the `StopFailure` payload (`error`, `error_details`, `last_assistant_message`) is taken from the Claude Code hooks docs; the fixture is hand-written, not recorded from a real logout. To check: log a Claude session out mid-step in a throwaway repo and watch the unit park with the logged-out reason.

## Merge danger

**Door:** two-way: a revert removes the mapping; an installed `StopFailure` hook entry would be left in `.claude/settings.json` until the next `norn init` (no data or format changes).

**Blast radius:** Claude units: if the mapping misfires, a Claude unit parks on an ask instead of being nudged. Repos with norn's hooks already installed get `StopFailure` only after re-running `norn init` (`norn doctor` says so until then).
