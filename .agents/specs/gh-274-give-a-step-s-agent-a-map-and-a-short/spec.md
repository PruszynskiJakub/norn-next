---
id: gh-274
slug: give-a-step-s-agent-a-map-and-a-short
provider: gh
number: 274
url: https://github.com/PruszynskiJakub/norn-next/issues/274
title: Give a step's agent a map and a short brief, and keep norn's own state out of its context
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:refinement
workflow: refinement
status: active
intake_at: 2026-11-07T10:20:30.339Z
body_hash: b2602b599264402664956616635e6f81374086e676888e0b2632baeddffbb2ae
---

## Observed

norn 0.25.0, measured in this repo on 43 step sessions (Claude session logs of the `norn-worktrees/gh-2xx-*` worktrees) and 666 stored briefings (`~/.norn/repos/<id>/briefings/`).

**Context before any work.** Every session starts with 53.8k–54.9k tokens on its first turn. Of that, about 5k is AGENTS.md (3.7k words), which is mostly maintainer reference a step never needs: the golden corpus, effect transcripts, observe snapshots, port contracts, the release process and design decisions. Most of the rest is the person's user-level setup: personal skills, plugins and MCP servers (mail, calendar, time tracking, …).

**Four hops before the work starts.** The launch prompt (B5) loads the norn skill (1.5k words with its references). The agent runs `norn brief`, loads the step skill, then reads the Inputs. The norn skill and the brief both explain done/ask/stuck, Resume, `runs/` and pushing. The dev-build warning is in both AGENTS.md and quick's `implement` instructions.

**The brief is mostly norn's state.**
- Stored briefings: median 728 words, p90 2,169, maximum about 496k words (gh-267's 3.4 MB handoff went into the brief untouched; there is no size guard).
- A first entry lists every counter of the workflow ("conflict_loop 0/2, qa_loop 0/2, review_loop 0/3, test_loop 1/5"), the mode, the run id, the deadline, nudges, retries and the port slot.
- Rulings repeat a paragraph of about 100 words in every brief.
- Inputs name files (`spec.md`, the handoff) but never the code the step should open.

**No map, so agents explore.** In gh-226's step session, 10 tool calls came before the first write:
- `gh issue view --comments`, although spec.md mirrors the issue;
- grepping RULES.md for rule ids;
- listing `docs/workflows.md`, which does not exist;
- hunting for `init.ts` and its tests.

**The handoff is one growing file per unit, shared by every step.**
- gh-215's story handoff is 2.4k words; gh-267's is 1.3k words, with a traceability table.
- Review reads the implementer's account before it judges the code.
- The brief drops another step's Resume with a regex (`dropSection`, `packages/core/src/brief.ts:386`) because the file is shared.
- The same story is told in five places: the handoff, each `done` receipt's `--handoff`, the Progress line norn appends, `pr.md`, and the issue's `## Triage` / `## Reproduce` comments.

**Code comments carry history.** `brief.ts` has comments such as `gh-195 B25 (D10)`, `T5a (gh-195 B24)` and `review F3`. An agent has to look each one up, and learns nothing about why the code is so.

## Wanted

Agents get a map and only the information that changes their decisions. Documents for people and documents for agents are kept apart.

1. **Documents by audience.**
   - For people: README, `docs/concepts.md`, `docs/reference.md`, `docs/recipes.md`, as today.
   - For agents:
     - AGENTS.md is a map of 500 words or fewer: layout, the five commands, the hard rules, and "for X read Y" pointers.
     - The detail moves to `docs/dev/*.md`, opened on demand (supersedes #133's split).
     - RULES.md is looked up by id, never read whole.
2. **A generated code map** (package → purpose → entry files → tests). The brief points at it, and norn ships the same idea for any repo.
3. **The brief carries the task, the rework, the files to open, the story note and how to finish.**
   - Counters show only during a fix round, and limits only when one is close.
   - The run id, mode and slot are for norn, not the agent.
   - Rework comes first when present.
   - The Plan's seams (files and tests) are listed as Inputs.
   - Every pasted block has a size cap and points to the file beyond it.
4. **One home for each instruction.**
   - The protocol goes in the system prompt once; the norn skill is kept for manual runs.
   - The step's outcomes go in the brief.
   - Craft goes in the skill (P7).
   - Repo must-follow rules go in reminders (#201).
   - Workflow YAML only routes: no prose about the repo.
5. **Start with the brief.** norn starts the agent with the brief as its first prompt, instead of "Use the norn skill, then run `norn brief`" (B5). `norn brief` stays for manual runs and resumes.
6. **A clean session profile.** A step agent starts with the project's settings and MCP servers only, not the person's user-level ones.
7. **The handoff becomes a story note plus a journal.**
   - The note has a fixed form that is shown and never parsed: Goal, Done means (criterion → shown by), Decisions, Not proven yet.
   - The note is capped at about 300 words, and `done` refuses when it is over.
   - The first version is kept so drift shows (#200).
   - The journal is the receipts, rendered by norn. norn no longer appends to the file (O6).
   - Resume belongs to one attempt. norn clears it at each report rather than dropping it when the brief is built.
8. **Comments explain why.** Rule ids appear only where a rule is enforced. Story and review ids live in `git blame`.
9. **Orientation cost in the trace:** tokens on the first turn, tool calls before the first edit, and files read but never edited, per step. These make the effect of each change above visible.

## Where

- `packages/core/src/brief.ts` (737 lines), `packages/core/src/handoff.ts`, `packages/core/src/commands.ts:5` (`AUTO_PROMPT`)
- `packages/cli/src/runtime/report.ts:84-110` (`receiptsWritten`, `appendProgress`)
- `packages/cli/assets/skills/norn/SKILL.md`
- `AGENTS.md`, `test/support/docs.ts` (docs lint set)
- `.agents/workflows/*.yaml` (`instructions:`)

## Rules

B3, B4, B5, B6, O6, S9, P7, MO3, F28. Related: #133 (AGENTS.md split), #200 (task note), #201 (reminders), #206 (prompt craft), #199 (evidence check), and #273 (handoff Progress bug).
