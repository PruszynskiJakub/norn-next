---
id: gh-301/07
title: Hooks re-orient after compaction and remind attended steps
depends_on: [gh-301/01, gh-301/02]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
---

## Goal
After a session in a unit worktree is compacted, resumed or cleared, the agent gets a short note with the unit, the step, its outcomes and the hard rules with their reasons; in an attended step, every prompt the person sends carries one line reminding the agent to report `done` only once they agree and to ask in the session.

## Scope
User stories: a re-orientation note after compact, resume or clear; no note at start-up; the attended reminder on every prompt; already-installed hooks take the new answers. Seams: S2, S3, S4 (the add-context encoding from gh-301/02). Decisions D10, D11. Out: refusals (gh-301/05, 06).

## Acceptance
- AC1 Given a unit worktree whose cursor is at an agent step, when a session starts from compact, resume or clear (Claude's sources and Codex's and Gemini's equivalents), then context is added naming the unit, the step, the outcomes it can report, every hard rule with its reason, and "run `norn brief` for the rest". — verifier: test
- AC2 Given a session start-up, or a worktree that is not a unit, or a unit whose state does not load or whose cursor is not at an agent step, then no note is added and the hook answers allow. — verifier: test
- AC3 Given the cursor at an attended agent step, when the person sends a prompt, then one line is added reminding the agent to report `norn done` only once the person agrees the work is finished and to ask in this session rather than with `norn ask`; at an unattended step no line is added. — verifier: test
- AC4 Given the hooks as `norn init` installs them today, when `norn hook` receives SessionStart and UserPromptSubmit events through the cli harness, then the note and the reminder are returned with no reinstall. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
The note's rules and reasons come from the core rules list (gh-301/01), so the brief and the hooks never word a rule two ways. The S3 cases are the integration tier: CI runs them.
