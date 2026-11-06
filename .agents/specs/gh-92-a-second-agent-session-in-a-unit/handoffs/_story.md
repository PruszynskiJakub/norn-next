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

- review#1 (approve, 3 minor findings, none blocking). The spec has no numbered Behaviour items; rows are the "Wanted" clauses (W1–W5):

| Item | Verifier | Proven by |
| --- | --- | --- |
| W1: another session's `norn brief` on a live run is refused (before and after the tick applies the run) | test | `packages/cli/test/integration/session-ownership.test.ts` › "session B's brief is refused before and after the tick applies the run; it names A's session"; core `agent-unit.test.ts` › "a run belongs to the session that started it…" |
| W2: another session's `done`/`ask`/`stuck` are refused and write no receipt (so no boundary commit of A's work) | test | `session-ownership.test.ts` › "session B cannot report the run: done, ask and stuck are refused and write no receipt" |
| W3: the refusal names the run's session and what to do (end this session / person retries fresh) | test | `session-ownership.test.ts` (brief test: `sess-A`, `norn run rerun gh-9`); `agent-unit.test.ts` (do_instead has `norn run rerun`) |
| W4: another session's hook facts are not credited to the run (no silent/stalled/nudge/transcript) and its turn end is not blocked | test | `session-ownership.test.ts` › "B's hook facts are not credited to A's run…"; `packages/store/test/unit/run-hooks.test.ts` › "a fact of another agent session in the worktree is not the run's…" |
| W5: the run's own session still briefs and reports it | test | `session-ownership.test.ts` › "the run's own session reports it" and the A re-brief in the brief test |
- review#1 approve: Review approve: MO3 session ownership does what gh-92 asks; every Wanted clause traced to tests (table in handoff). 3 findings, 0 blocking: auto runs with unknown session unprotected (accepted by MO3), callerSession matches Claude's PreToolUse only, misplaced doc comment in hook.ts.

## Resume

Review approved; nothing to rework. Minor findings (not blocking) are in review#1's findings receipt.
