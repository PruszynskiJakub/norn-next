## Summary

A run now belongs to the agent session that started it (MO3). A second agent session in the unit worktree can no longer brief or report that run. Its hook facts no longer count toward the run, so its report can never commit the first session's work in progress.

```diff
 norn brief | done | ask | stuck            (packages/cli: brief.ts, runtime/report.ts)
   run = current run of the unit
+  caller = callerSession(...)              // this call's PreToolUse fact, else latest session fact, else NORN_AGENT_SESSION_ID
+  owner  = runAgentSession(run)            // state.run.agent_session_id, else the run's latest `started` receipt
+  if owner && caller && owner != caller
+    refuse foreign_session                 // names owner; do_instead: end your turn, or person: norn run cancel + norn run rerun

 norn hook <event>                          (packages/cli: commands/hook.ts)
-  fact.run_id = run.run_id
+  fact.run_id = run.run_id unless the fact's session is foreign
+  a foreign session's Stop is never blocked

 runHooks(hooks, run, worktree)             (packages/store: local-facts.ts)
-  unstamped facts in the worktree since the run started
+  ... and only those from the run's own session or an unknown one   // no silent/stalled/nudge/transcript from another session
```

When either session is not known (headless, no hooks yet), nothing is refused, as before. MO3 in `.agents/RULES.md` now says this.

## Evidence

The spec has no numbered Behaviour items, so the entries below follow its "Wanted" clauses (W1–W5). The `test` step ran the unit and integration tiers and the type check and passed. Review traced every clause to a test. No QA criteria report exists for this `quick` round. According to the implement handoff, `session-ownership.test.ts` was red without the fix. This PR does not re-show that run.

- **W1** Another session's `norn brief` on a live run is refused
  **Before:** session B's `norn brief` got the same `run_id` with no warning (gh-79, step 2 of Observed)
  **After:** `packages/cli/test/integration/session-ownership.test.ts` › "session B's brief is refused before and after the tick applies the run; it names A's session". It checks `as("sess-B", "brief")` → exit 3, `code: "foreign_session"`, and does this both before and after the tick records `run.agent_session_id = sess-A`. Core `agent-unit.test.ts` also checks `foreignSessionRefusal(owner=A, caller=B)` and `runAgentSession` from both state and the `started` receipt.
- **W2** Another session's `done` / `ask` / `stuck` are refused and write no receipt, so they cannot trigger a boundary commit of A's work
  **Before:** B's `norn ask` parked the unit, and its commit included A's uncommitted fix (gh-79, step 4)
  **After:** `session-ownership.test.ts` › "session B cannot report the run…". With an uncommitted file in the worktree, each of B's `done` / `ask` / `stuck` → exit 3 `foreign_session`, and the receipts dir is unchanged.
- **W3** The refusal names the run's session and says what to do
  **After:** the same brief test checks that `error` contains `sess-A` and `do_instead` contains `norn run rerun gh-9`. The text is "end your turn and leave the step to session sess-A; if that session is gone, a person retries the step in a fresh session: norn run cancel …, then norn run rerun …".
- **W4** Another session's hook facts are not credited to the run, and its turn end is not blocked
  **Before:** B's turn end was classified `silent`, nudged the run and snapshotted B's transcript (gh-79, step 6)
  **After:** `session-ownership.test.ts` › "B's hook facts are not credited to A's run…". B's Stop → `{}` (not blocked) and none of B's facts carry `run_id`. A's Stop is still blocked and A's facts carry the run. `packages/store/test/unit/run-hooks.test.ts` checks that `runHooks(owner=A)` keeps A's facts, unknown-session facts and stamped facts, and drops B's. A run with no known session keeps all of them.
- **W5** The run's own session still briefs and reports it
  **After:** `session-ownership.test.ts` › "the run's own session reports it" (`as("sess-A", "done", "done")` → `ok`, same `run_id`), plus A's re-brief in the W1 test.

Not covered (reviewed and accepted as minor):
- An auto-launched run with no recorded `agent_session_id` has no owner until one is known, so it is not protected.
- `callerSession` matches only Claude's `PreToolUse` for "this very call". Other agents fall back to the latest session fact in the worktree.

## Merge danger

**Door:** two-way: no persisted format changes. `agent_session_id` was already in `started` receipts and `state.run`, so a revert restores the old behaviour completely.

**Blast radius:** agent sessions. The risk is a wrong `foreign_session` refusal that blocks a run's real owner. That could happen if a non-Claude agent's caller session is guessed from another live session's fact, or if a resumed agent comes back with a new session id. The owner is then stuck until a person runs `norn run cancel` + `norn run rerun`. When the session is unknown, nothing changes.
