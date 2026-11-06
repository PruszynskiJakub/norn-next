## Goal

A run belongs to the agent session that started it (MO3): another session in the unit worktree cannot brief or report it, and its hook facts are not credited to the run.

## Progress

- Core `runAgentSession` / `foreignSessionRefusal` (`packages/core/src/agent-unit.ts`): the run's session from state.run or its latest `started` receipt; refusal `foreign_session` names it and tells the person to `norn run cancel` + `norn run rerun`. Nothing is refused when either session is unknown (headless/no hooks).
- Caller identity: cli `callerSession` (`packages/cli/src/runtime/agent-unit.ts`, moved from brief's `recentSession`) prefers the PreToolUse fact of this very `norn <verb>` call, else the latest session fact, else `NORN_AGENT_SESSION_ID`. `startRun` uses it too.
- `brief` and `reportTarget` (done/ask/stuck) call `refuseForeignSession`; `hook` stamps `run_id` only on the run's own (or unknown) session's facts and never blocks a foreign session's Stop; store `runHooks` drops unstamped facts of another session, so no silent/stalled/nudge/transcript from them.
- MO3 amended in `.agents/RULES.md`.
- Tests: `packages/cli/test/integration/session-ownership.test.ts` (triage repro; red without the fix), core `agent-unit.test.ts`, store `run-hooks.test.ts`. `agent-protocol.test.ts`'s attended test fired Stop as another session than the run's; now uses `sess-pair`.
- Not done: the boundary commit still stages the whole worktree (`git add -A`); with the refusal, only the run's own session can trigger a report commit. An auto-launched run with no recorded `agent_session_id` is not protected until one is known.
- implement#1 done: MO3: a run belongs to the session that started it. brief/done/ask/stuck from another agent session are refused (foreign_session, names the owner, points the person to run cancel + run rerun); that session's hook facts are not stamped with or credited to the run (hook.ts, store runHooks) and its Stop is not blocked. Nothing refused when either session is unknown. Tests: integration session-ownership (red without fix), core agent-unit, store run-hooks; RULES MO3 amended. Boundary commit still uses git add -A (out of scope).

## Resume

Nothing left for implement; next step is review.
