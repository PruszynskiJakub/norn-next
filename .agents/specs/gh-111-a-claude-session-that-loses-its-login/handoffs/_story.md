## Goal

A Claude session that loses its login mid-step parks on an implicit ask that says "agent logged out — run `/login` in the pane", instead of going `agent.silent` → nudges → `stuck`.

## Done means

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| Adapter recognises the logged-out state | `StopFailure` with `error: authentication_failed` becomes a `waiting_input` fact "agent logged out — run `/login` in the pane"; other errors ignored; hook installed | test | `packages/adapters/test/unit/claude/claude.test.ts` › "claude StopFailure …" and "claude hooks install" (key list has `StopFailure`) |
| Treated like the usage-limit wait, no nudges spent | the logged-out fact parks on `agent.ask.implicit` with that reason and spends no nudge ; the park holds through the idle notification that follows | test | `packages/adapters/test/unit/claude/claude.test.ts` › "the idle notification after a failed login is dropped…" (refineHooks); `packages/core/test/unit/decide.test.ts` › "a logged-out session parks on an implicit ask…" (still parked 30 min later, `nudges_used` 0) |
| After the login, the run continues in the same session | the session's next prompt after `/login` ends the park and the run goes on, nudges untouched | test | `packages/core/test/unit/decide.test.ts` › "a logged-out session parks on an implicit ask…" (a later `UserPromptSubmit` → `agent.ask.implicit.resolved`, run goes on) |

- `bun run test` (1292 pass) and `bun run typecheck`: green on the reviewed HEAD (review#2).

## Easy to miss

- `StopFailure` output is ignored by Claude Code, so `hookResponse` never blocks it (it is not `Stop`, so `refusableTurnEnd` is false).
- Repos with norn's hooks already installed get `StopFailure` only after `norn init` runs again; `norn doctor` reports "run norn init to install hooks" until then. This repo's tracked `.claude/settings.json` was not changed: the released `norn` does not know `stop-failure` yet, so re-run `norn init` after the release.

## Not proven yet

- The `StopFailure` payload shape (`error`, `error_details`, `last_assistant_message`) comes from the Claude Code hooks docs and the strings in its binary (see the issue's Triage); the fixture `StopFailureAuth` is written by hand, not recorded from a real logout.

## Notes

- The idle-notification fix lives in the Claude adapter's `refineHooks`, not in decide: after a logged-out `StopFailure`, that session's idle `Notification` (`turn_end`) facts are dropped until any other fact of the session arrives. Decide stays agent-neutral; its test feeds the hooks as refined (no decide test can see the drop itself, so the adapter test is the seam for that half).
- Only `authentication_failed` is mapped. `billing_error` could deserve the same treatment, but that is outside this story.

## Resume

describe#1 wrote pr.md in the spec folder (summary, test evidence, merge danger); next is the workflow's step after describe.
