## Goal

A Claude session that loses its login mid-step parks on an implicit ask that says "agent logged out — run `/login` in the pane", instead of going `agent.silent` → nudges → `stuck`.

## Done means

- The Claude adapter registers the `StopFailure` hook and maps `error: authentication_failed` to a `waiting_input` fact with the logged-out message; other `StopFailure` errors stay ignored: `packages/adapters/test/unit/claude/claude.test.ts` ("claude StopFailure …", and the hooks-install key list now has `StopFailure`).
- decide parks that fact on `agent.ask.implicit` with the logged-out reason and spends no nudge: `packages/core/test/unit/decide.test.ts` ("a logged-out session parks on an implicit ask that says so, spending no nudge").
- `bun run test` and `bun run typecheck` are green.

## Easy to miss

- `StopFailure` output is ignored by Claude Code, so `hookResponse` never blocks it (it is not `Stop`, so `refusableTurnEnd` is false).
- Repos with norn's hooks already installed get `StopFailure` only after `norn init` runs again; `norn doctor` reports "run norn init to install hooks" until then. This repo's tracked `.claude/settings.json` was not changed: the released `norn` does not know `stop-failure` yet, so re-run `norn init` after the release.

## Not proven yet

- The `StopFailure` payload shape (`error`, `error_details`, `last_assistant_message`) comes from the Claude Code hooks docs and the strings in its binary (see the issue's Triage). It was not recorded from a real logout, because that would log out the person's own session. The fixture `StopFailureAuth` is written by hand.
- "After the login, the run continues in the same session": this relies on the existing implicit-ask resolution (R6.1). The next non-wait hook fact (such as `UserPromptSubmit` once someone types into the pane), or a person's answer to the ask, ends the park. `auth_success` stays ignored, because it does not mean the agent moved on.

## Notes

- Only `authentication_failed` is mapped. `billing_error` could deserve the same treatment, but that is outside this story.

## Resume

Nothing left for implement; the next step is review/CI.
