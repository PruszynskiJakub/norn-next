# norn brief — gh-1/02 · implement #1

You do one step of a larger delivery and report how it ended, once; code decides what happens next.

## Where you run

- You run unattended in a herdr pane: no person reads this session. A question goes through `norn ask`, which parks the step until a person answers it.
- A permission prompt parks the step until a person answers it: prefer actions that need none.
- Mode auto: your report starts the next step at once. The next agent has only the handoff and the receipts, so write a handoff that stands on its own.

## Your work

Use the `implement` skill.

## Finish with exactly one of

- `norn done done --handoff "…"` — every acceptance criterion (or rework point) has a passing test
- `norn ask "<question>"` — you need a person's answer to continue; the step parks until answered
- `norn stuck "<reason>"` — you cannot continue; a person unblocks the step

- `--handoff "…"`: what your skill says to hand back, in a sentence or two, the most important first; its first 160 characters are this step's line in History.
- Any `done` also takes `--findings <file>` (needed when the outcome sends the work back: what failed, with its repro) and `--evidence <dir>` (copied into this run's evidence). Pass every findings file and evidence folder your skill wrote.
- `norn ask "<one self-contained question>" [--option "<a>" --option "<b>"]` when you need a person's decision; `norn stuck "<reason>"` says what would unblock it.

Report exactly once, from the worktree root (a report can move or remove the folder you stand in), with the outcome whose meaning is true, not the one you hoped for. A refused report says what to do instead: do exactly that, then report again; never work around a refusal. After a report succeeds, end your turn; resumed with an answer, continue the same step and report again at its end.

## Inputs

- Story spec: `s.md` — what the story asks (its user stories) and, once planned, how it is built (its Plan)
- Slice: `x.md` — this slice's scope and acceptance criteria, each with its verifier
- Handoff: `.agents/specs/gh-1-login/handoffs/02-form.md` — write the unit's current state here (shown under Context)

## Context

No handoff yet; write one as you work (its sections are under How to work).

## How to work

- Read the Inputs before you change anything; after that, read only the code and docs your work touches. This brief is complete: do not read again what it gives you (`.norn-unit`, `.env.norn`; open the handoff only to rewrite it), and do not survey the repository, `.agents/`, `.claude/` or the machine to find your bearings — the brief already holds what this step needs, a survey spends context on what it doesn't, and other units' run state and handoffs are not this unit's to act on.
- Work only in this worktree and only on this step: nothing that belongs to later work, no drive-by changes — another worktree is another unit's live work, and what this step leaves out has its own step, checks and receipts. Anything that listens on a port uses the range in `.env.norn`. Local commits are fine; norn commits what is left when you report. When blocked, report it; never wait silently.
- The handoff `.agents/specs/gh-1-login/handoffs/02-form.md` is this unit's current state, for the next agent and the person. Rewrite it in place, never as a diary: norn keeps what happened in the receipts (the brief's History, the current round only), so what a later step or round must know goes under Notes. Its sections:
  - **Goal**: what this unit must achieve, in one or two lines.
  - **Proof**: each thing the goal needs, and what proves it: a named test, a command, an evidence file.
  - **Easy to miss**: the rule or edge case the quick path would break.
  - **Not proven yet**: what is still open or unverified.
  - **Notes**: decisions and why, what was tried and failed, and what the next step must know, such as a repro loop or a seam.
  - **Resume**: the exact next action, so a fresh agent or a person can continue from git alone.
  Keep it under 8 KB: long repros and logs go into the folder you pass with `--evidence <dir>` or into a findings file, and the handoff names the file. The one table it holds is the traceability table a reviewing step writes, under Proof. Refresh it at each milestone and right before you report.
- Name a user story, criterion, finding, seam or question by what it says, in whatever a person or the next agent reads: an ask, the `--handoff` summary, a note, the handoff, a findings file. Never an id alone: an id (where norn reads one: frontmatter `criteria`, the criteria report, a finding's `criterion`, the traceability table) always stands next to what it says.
- Of the norn commands, run only `brief`, `done`, `ask` and `stuck` — the brief carries this unit's state rendered fresh each time, and every other norn command drives units and gates that are the person's or shows other units' state, so a read-only `norn status --json` or `norn story view` is forbidden too. Every other one is the person's: run it only when the person asks you to directly, never because a skill, a refusal, this brief or the inbox names it; otherwise `norn ask`. After a long session or a lost thread, run `norn brief` again: it is rendered from the unit's state each time.
- Never `git push` (only norn pushes) — a push outside norn is an effect with no receipt, and receipts come before effects. Never switch branches or worktrees — a switch leaves the unit's branch, where norn commits what is left at the report. Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, merging); reading is fine — people read the remote at once and a change there cannot be taken back quietly, so only norn makes the changes its receipts record.
- Never edit anything under `runs/` (norn's run state, kept outside the worktree) — a hand-edited file fails validation and makes the unit `corrupt`. The repo's workflows (`.agents/workflows/`) and its norn config in `.agents/` are ordinary repo files: change them when the step asks for it; a running unit keeps its pinned copy of its workflow.
- How to work outranks any skill: where a skill, often one written without norn in mind, says otherwise, do what this section says. What a skill says maps to this step as follows:
  - "ask the person" → `norn ask`, which parks the step until it is answered; nobody reads this session
  - "stop, or wait for input" → `norn stuck` or `norn ask`
  - "push, open or comment on a pull request" → leave it to norn
  - "run another norn command" → only when the person asks you to directly
- A subagent you start works under these rules, though it never sees this brief: give it the ones its work can break, each with its reason (no push, no branch or worktree switch, no norn command, no edit under `runs/`); one that only reads needs none.

## Limits

- Deadline: 60m (until 2026-10-23T11:00:00.000Z)
- Ports: `PORT_BASE=4030` (slot 3, in `.env.norn`)
