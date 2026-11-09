### Goal

After a session in a unit worktree is compacted, resumed or cleared, the hook adds a note (unit, step, reportable outcomes, every hard rule with its reason, "run `norn brief` for the rest"); in an attended agent step every prompt carries one reminder line.

### Proof

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | note after compact, resume or clear (Claude, and Codex's/Gemini's equivalents): unit, step, outcomes, every hard rule with its reason, "run `norn brief` for the rest" | test | Claude: `packages/core/test/unit/hook-answer.test.ts` › "a session started from %s is re-oriented…", "a review step's note names the outcomes it can report", "an attended step is re-oriented too". Codex/Gemini: partial (review F4): no adapter test asserts that `source` reaches `message` |
| AC2 | no note at start-up, outside a unit, with unloadable state or a cursor not at an agent step; the hook allows | test | same file › "start-up, an unknown source, no loadable unit or a cursor not at an agent step add nothing"; `packages/cli/test/integration/agent-protocol.test.ts` › "attended steps never block" (start-up, gate) |
| AC3 | one reminder line on each prompt at an attended agent step; none at an unattended step | test | same file › "each prompt in an attended agent step carries one line…", "an unattended step, no loadable unit or a non-agent step add no line" |
| AC4 | the hooks as `norn init` installs them return the note and the reminder, with no reinstall | test | `packages/cli/test/integration/agent-protocol.test.ts` › "attended steps never block" (integration tier, CI) |

`bun run test` (1601 pass) and `bun run typecheck` are green at review.

### Easy to miss

- The session source comes from `HookFact.message`: each adapter already puts SessionStart's `source` there. A missing source counts as start-up, so no note is added.
- The note's rules come from `HARD_RULES` / `ruleWithReason`, so the brief and the hook never word a rule two ways.
- The note is added at attended steps too. The reminder is added only at attended steps. Neither one is added at gates, checks or `$done`.

### Not proven yet

- Review F4 (blocking): no adapter test proves that Codex's and Gemini's SessionStart `source` reaches `HookFact.message`.
- Review F1 (blocking): at an attended step the session-start note offers `norn ask`, which the brief and the reminder forbid.
- Codex and Gemini fire no SessionStart on compaction (Gemini has PreCompress, which is not mapped), so those tools get no note after a compact (review F5).
- AC4's integration case has not been run locally (it is integration tier, so CI runs it).
- How Codex and Gemini encode added context comes from slice 02 and has not been seen on a real tool.

### Notes

- `hookAnswer` sends events by kind: `session_start` → `sessionNote`, `turn_start` → `attendedReminder`, everything else → `turnEndBlock`. Slices 05 and 06 (refusals on `tool_use`) add their own branch here, so expect a small merge in `packages/core/src/hook.ts`.
- Added context is never a `block`, so it never spends the turn-end cap.

### Resume

Review #1 requested changes (findings F1 and F4 are blocking). Next: rework those two. Leave `norn ask` out of the note at an attended step and assert that in "an attended step is re-oriented too". Add Codex and Gemini SessionStart parse cases asserting `message`.
