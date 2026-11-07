---
name: norn
description: The protocol for doing one norn step and reporting it once with `norn done`, `norn ask` or `norn stuck`. Use when told to use the norn skill and run `norn brief`, when the working directory has a `.norn-unit` file, or when asked to continue a norn step.
---

# norn: one step, one report

You do one step of a larger delivery and report how it ended. Code decides what happens next: you never pick, name or skip steps.

## 1. Read the brief

Run `norn brief` in this worktree. If it refuses because this is not a unit worktree (the repo's main checkout, say), stop and tell the person to start the agent from the unit's item in `norn status` (`norn story start <unit>` opens or prints it). Never change directory to look for the work yourself.

The brief is complete. Then:

- Load the skill it names and follow it for the craft; its extra instructions add to it.
- Do its Rework points, when present, before anything else.
- Read its Inputs before you change anything; after that read only the code and docs your work touches, when you need them.
- Do not read again what it already gives you (the handoff, `.norn-unit`, `.env.norn`), and do not survey the repository, `.agents/`, `.claude/` or the machine to find your bearings.
- A Resume written by another step is left out of its Context on purpose: it is not your instruction.

## 2. Work in scope

- Work only in this worktree, and only on what this step asks: nothing that belongs to later work, no drive-by changes.
- Anything that listens on a port uses the range in `.env.norn`.
- Local commits are fine. norn commits what is left when you report.
- When blocked, report it. Never wait silently.

## 3. Keep the handoff current

The handoff is `handoffs/<unit>.md` in the spec folder (`_story.md` for the story, `<nn>-<slug>.md` for a slice); the brief's Inputs name it. It is prose for you and the person; the step's state is in the brief. Keep three sections:

- **Goal**: what this step must achieve, in one or two lines.
- **Progress**: milestones done, decisions and why, what was tried and failed.
- **Resume**: the exact next action, so a fresh agent or a person can continue from git alone.

Refresh it at each milestone and always right before you report.

## 4. Report exactly once, then end your turn

Run the report from the worktree root: reporting can move or remove a folder you stand in. Pick exactly one:

- `norn done <outcome> --handoff "<short summary>" [--findings <file>] [--evidence <dir>] [--criteria <file>] [--note "<text>" [--note-criterion <id>]]`
  The outcome is one the brief's "Finish with" lists, and the one whose meaning is true, not the one you hoped for. Pass every findings file and evidence folder your skill produced; an outcome that sends the work back needs `--findings` (what failed, with repro), or the next run has only your summary. When "Finish with" asks for `--criteria`, it is required, and an outcome that contradicts the worst verdict is refused.
- `norn ask "<question>" [--option "<a>" --option "<b>"]`: you need a person's decision to continue. One self-contained question.
- `norn stuck "<reason>"`: you cannot continue (no access, broken environment, contradictory spec). Say what would unblock it.

When a person works with you in the pane, report `done` only once they agree.

If a report refuses (`**Refused (…):** …` with "Do instead: …" and a non-zero exit code), do exactly what "Do instead" says, then report again. Never work around a refusal.

After a report succeeds, end your turn: no more work, no second report. If you are resumed with an answer, continue the same step and report again at its end.

## Talk in words

Whatever a person reads from you (an `ask`, the `--handoff` summary, a `--note`, a reply in the pane) names a user story, criterion, finding, seam or question by what it says, not by a number or id: "the warning on open cards fails", not "story 2 fails" or "AC3 is open". Files you write for the next agent (findings, slice files, the handoff) do the same: the words carry the context, a number carries none. An acceptance criterion's id goes only where norn reads it (frontmatter `criteria`, the criteria report, a finding's `criterion`), always next to what the criterion says.

## Hard rules

- Of the norn commands, run only `brief`, `done`, `ask` and `stuck` (`norn help` marks them). Every other one (`story approve`, `story answer`, `run rerun`, `story start`, `tick`, …) is the person's: run one only when the person asks you to directly, never because a refusal, the brief or the inbox names it. Otherwise `norn ask`.
- Never `git push` (only norn pushes), and never switch branches or worktrees.
- Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, merging). Reading is fine.
- Never edit anything under `runs/` (norn's run state, kept outside the worktree). The repo's workflows (`.agents/workflows/`) and config (`.agents/norn.config.yaml`) are ordinary repo files: change them when the step asks for it. A running unit keeps its own pinned copy of its workflow, so the edit takes effect on later rounds.
