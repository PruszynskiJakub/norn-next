### Goal

After a session in a unit worktree is compacted, resumed or cleared, the hook adds a note (unit, step, reportable outcomes, every hard rule with its reason, "run `norn brief` for the rest"); in an attended agent step every prompt carries one reminder line.

### Proof

- AC1 (note after compact, resume or clear, for Claude, Codex and Gemini): `packages/core/test/unit/hook-answer.test.ts` › "a session started from %s is re-oriented…", "Codex's and Gemini's session starts…", "a review step's note names the outcomes it can report", "an attended step is re-oriented too" — red before `sessionNote` existed.
- AC2 (no note at start-up, with no unit, or when the cursor is not at an agent step): same file › "start-up, an unknown source, no loadable unit or a cursor not at an agent step add nothing".
- AC3 (attended reminder, no line when unattended): same file › "each prompt in an attended agent step carries one line…" (went red first), "an unattended step, no loadable unit or a non-agent step add no line".
- AC4 (hooks as `norn init` installs them, through the cli harness): `packages/cli/test/integration/agent-protocol.test.ts` › "attended steps never block" — runs the installed `SessionStart`/`UserPromptSubmit` commands from `.claude/settings.json` and gets `hookSpecificOutput.additionalContext`. This is the integration tier, so CI runs it. Following the brief, it was not run locally.
- `bun run test` (1601 pass) and `bun run typecheck` are green.

### Easy to miss

- The session source comes from `HookFact.message`: each adapter already puts SessionStart's `source` there. A missing source counts as start-up, so no note is added.
- The note's rules come from `HARD_RULES` / `ruleWithReason`, so the brief and the hook never word a rule two ways.
- The note is added at attended steps too. The reminder is added only at attended steps. Neither one is added at gates, checks or `$done`.

### Not proven yet

- AC4's integration case has not been run locally (it is integration tier, so CI runs it).
- How Codex and Gemini encode added context comes from slice 02 and has not been seen on a real tool.

### Notes

- `hookAnswer` sends events by kind: `session_start` → `sessionNote`, `turn_start` → `attendedReminder`, everything else → `turnEndBlock`. Slices 05 and 06 (refusals on `tool_use`) add their own branch here, so expect a small merge in `packages/core/src/hook.ts`.
- Added context is never a `block`, so it never spends the turn-end cap.

### Resume

Nothing left in this step: reported `done`. Next is review of this slice.
