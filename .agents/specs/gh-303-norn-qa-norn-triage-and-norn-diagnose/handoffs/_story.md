### Goal

norn-qa, norn-triage and norn-diagnose use subagents where they pay off, each with a "when you cannot start subagents, do it yourself" fallback worded like norn-review's.

### Proof

- norn-qa: one subagent per independent criterion, against the one environment the main agent prepared; runs in parallel only for criteria that leave shared state alone; the main agent writes the criteria report from the evidence files; command-running subagents get the four rules with reasons. Test: `packages/cli/test/unit/assets.test.ts` › "norn-qa collects each independent criterion's evidence in its own subagent against one prepared environment".
- norn-triage: a subagent reads the code and returns `file:line` usages and its conclusion, not the files. Test: › "norn-triage has a subagent read the code and bring back file:line usages and its conclusion, not the files".
- norn-diagnose: exploration in a subagent (phase 1); optional fresh subagent given only the loop and the symptom proposes hypotheses before any is tested (phase 3). Test: › "norn-diagnose explores the code in a subagent and may ask a fresh one, given only the loop and the symptom, for hypotheses".
- Fallback in all four subagent-using skills: › "%s does the work itself when it cannot start subagents".
- `bun run test` (1730 pass) and `bun run typecheck` green. `.agents/skills/` copies match `packages/cli/assets/skills/`.

### Easy to miss

- Craft skills must stay norn-unaware (lint "is unaware of norn"): they cannot say "brief", so the QA rules use norn-review's generic "delivery tool" wording rather than pointing to the brief.
- The brief's line about subagent rules (`packages/core/src/brief.ts`) is unchanged: no blanket "use subagents" line, as the issue asks.

### Not proven yet

- Nothing beyond the text pins: whether agents actually split work as described shows only in real QA/triage/reproduce runs.

### Notes

- The norn-review rules check in the test file became a helper (`expectSubagentRules`) shared by norn-review and norn-qa.
- Triage and diagnose subagents only read, so they get no rules list.
- Friction: norn's own tick commits ("mirror gh-303 from the remote issue", "mode manual → auto") swept up my uncommitted skill edits, so the change sits inside norn's commits rather than a commit of its own.
- The worktree needed `bun install` before the unit tier would run.

### Resume

Review the change against the issue (quick round).
