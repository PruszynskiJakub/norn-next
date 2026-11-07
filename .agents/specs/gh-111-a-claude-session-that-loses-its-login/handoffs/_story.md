## Goal

A Claude session that loses its login mid-step parks on an implicit ask that says "agent logged out — run `/login` in the pane", instead of going `agent.silent` → nudges → `stuck`.

## Done means

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| Adapter recognises the logged-out state | `StopFailure` with `error: authentication_failed` becomes a `waiting_input` fact "agent logged out — run `/login` in the pane"; other errors ignored; hook installed | test | `packages/adapters/test/unit/claude/claude.test.ts` › "claude StopFailure …" and "claude hooks install" (key list has `StopFailure`) |
| Treated like the usage-limit wait, no nudges spent | the logged-out fact parks on `agent.ask.implicit` with that reason and spends no nudge | test | partial: `packages/core/test/unit/decide.test.ts` › "a logged-out session parks on an implicit ask that says so, spending no nudge" proves the first park only; the following idle notification un-parks it (review finding below) |
| After the login, the run continues in the same session | a later non-wait hook or a person's answer ends the park | test | UNTRACED (relies on the existing implicit-ask resolution; no test for this story) |

- `bun run test` and `bun run typecheck`: green in test#1.

## Easy to miss

- `StopFailure` output is ignored by Claude Code, so `hookResponse` never blocks it (it is not `Stop`, so `refusableTurnEnd` is false).
- Repos with norn's hooks already installed get `StopFailure` only after `norn init` runs again; `norn doctor` reports "run norn init to install hooks" until then. This repo's tracked `.claude/settings.json` was not changed: the released `norn` does not know `stop-failure` yet, so re-run `norn init` after the release.

## Not proven yet

- **Review finding (blocking): the park does not hold.** About 60 s after the failed login, Claude Code's `idle_prompt` notification (mapped to `turn_end`) arrives; `implicitAskResolved` (`packages/core/src/decide/agent.ts:419`) ends any implicit ask on a newer non-wait hook, so the ask resolves as "moved on" while the session is still logged out, the run later goes `agent.stalled`, and nudges are spent. Needs a fix and a decide test with a later `idle_prompt` hook.
- "After the login, the run continues in the same session" has no test of its own (UNTRACED).
- The `StopFailure` payload shape (`error`, `error_details`, `last_assistant_message`) comes from the Claude Code hooks docs and the strings in its binary (see the issue's Triage); the fixture `StopFailureAuth` is written by hand, not recorded from a real logout.

## Notes

- Only `authentication_failed` is mapped. `billing_error` could deserve the same treatment, but that is outside this story.

## Resume

Rework: keep the logged-out implicit ask parked through the idle notification that follows it (fix in decide's implicit-ask resolution or in the Claude adapter's `refineHooks`), then add decide tests for a later `idle_prompt` (stays parked, no nudge) and a later `UserPromptSubmit` (resolves).
