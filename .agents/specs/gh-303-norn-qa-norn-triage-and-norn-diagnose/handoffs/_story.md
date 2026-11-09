### Goal

norn-qa, norn-triage and norn-diagnose use subagents where they pay off, each with a "when you cannot start subagents, do it yourself" fallback worded like norn-review's.

### Proof

Tests in `packages/cli/test/unit/assets.test.ts`; `bun run test` (1730 pass) and `bun run typecheck` green at review; `.agents/skills/` copies match `packages/cli/assets/skills/`.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| — | norn-qa collects each independent criterion's evidence in its own subagent; the main agent prepares the environment once and writes the criteria report | test | › "norn-qa collects each independent criterion's evidence in its own subagent against one prepared environment" |
| — | norn-triage: a subagent reads the code and returns `file:line` usages and the conclusion, not the files | test | › "norn-triage has a subagent read the code and bring back file:line usages and its conclusion, not the files" |
| — | norn-diagnose: exploration in a subagent; optional fresh subagent given only the loop and the symptom proposes unanchored hypotheses | test | › "norn-diagnose explores the code in a subagent and may ask a fresh one, given only the loop and the symptom, for hypotheses" |
| — | each skill keeps the "when you cannot start subagents, do it yourself" fallback | test | › "%s does the work itself when it cannot start subagents" (norn-review, norn-qa, norn-triage, norn-diagnose) |
| — | a subagent that writes files or runs commands (QA's) gets the hard rules it could break, with reasons | test | › "norn-qa collects…" via `expectSubagentRules("norn-qa")` |
| — | no blanket "use subagents" line in the brief | test | `packages/core/src/brief.ts` untouched by the diff (read at review) |

### Easy to miss

- Craft skills must stay norn-unaware (lint "is unaware of norn"): the QA rules use norn-review's generic "delivery tool" wording rather than pointing to the brief.
- The brief's line about subagent rules (`packages/core/src/brief.ts`) is unchanged, as the issue asks.

### Not proven yet

- Nothing beyond the text pins: whether agents actually split work as described shows only in real QA/triage/diagnose runs.

### Notes

- Review #1 approved with one minor finding (left for the person, not rework): norn-diagnose's fresh hypothesis subagent is handed "the loop" but no rules, in case it runs the loop (`packages/cli/assets/skills/norn-diagnose/SKILL.md:49`).
- The norn-review rules check in the test file became a helper (`expectSubagentRules`) shared by norn-review and norn-qa.
- Triage and diagnose subagents only read, so they get no rules list.
- Friction: norn's own tick commits swept up uncommitted skill edits, so the change sits inside norn's commits rather than a commit of its own.
- The worktree needed `bun install` before the unit tier would run.

### Resume

pr.md (spec folder) describes the branch: summary picture, test-based evidence per Wanted point (no QA ran), two-way door, blast radius agent runs. Next: norn opens the PR.
