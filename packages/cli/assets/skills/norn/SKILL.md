---
name: norn
description: The protocol for doing one norn step and reporting it. Use when a session starts with "Use the norn skill, then run `norn brief`", when the working directory contains a `.norn-unit` file, or when asked to pick up, continue or report norn work. Covers reading the brief, staying in scope, keeping handoff.md current, and reporting exactly once with `norn done`, `norn ask` or `norn stuck`.
---

# norn: one step, one report

You do exactly one step of a larger delivery and report how it ended. Code decides what happens next. You never pick, name or skip steps.

## 1. Read the brief

Run `norn brief` in this worktree. If it refuses because this is not a unit worktree (for example the repo's main checkout), stop and tell the person to start the agent from the unit's item in `norn status` (`norn story start <unit>` opens or prints it). Never change directory to look for the work yourself.

The brief prints as markdown (`norn brief --json` for data). It gives:

- **Where you are**: story, slice, step, attempt, mode, whether a person works with you.
- **Why this attempt**: when present, why the step runs again (a session that died, or an earlier attempt that judged older code).
- **The skill to use**: load it and follow it for the craft. Extra instructions add to it.
- **Inputs**: spec, slice file, diff range. Read them before you change anything.
- **Rework**: when present, these points come before anything else.
- **Context**: the written part of handoff.md and any answer to an earlier question. A Resume written by another step is left out; it is not your instruction.
- **Finish with**: the outcomes you may report and what each one means, and the criteria to give a verdict on when a report is required.
- **Limits**: deadline, nudges left, port slot.

The brief is complete. Do not read again what it already gives you (handoff.md, `.norn-unit`, `.env.norn`), and do not survey the repository, `.agents/`, `.claude/` or the machine to find your bearings. Read the inputs, then only the code and docs your work touches, when you need them.

## 2. Work in scope

- Work only in this worktree, and only on what this step asks. Nothing that belongs to later work; no drive-by changes.
- Anything that listens on a port uses the range in `.env.norn`.
- Local commits are fine. norn commits what is left when you report, and only norn pushes.
- When blocked, report it. Never wait silently.

## 3. Keep handoff.md current

The top block is generated: never edit it. Below it, keep three sections:

- **Goal**: what this step must achieve, in one or two lines.
- **Progress**: milestones done, decisions and why, what was tried and failed.
- **Resume**: the exact next action, so a fresh agent or a person can continue from git alone.

Refresh it at each milestone and always right before you report.

## 4. Report exactly once, then end your turn

Pick exactly one:

- `norn done <outcome> --handoff "<short summary>" [--findings <file>] [--evidence <dir>] [--criteria <file>] [--note "<text>" [--note-criterion <id>]]`
  The outcome must be one listed under "Finish with". Pick the one whose meaning is true, not the one you hoped for. Pass every findings file and evidence directory your skill produced; an outcome that sends the work back needs `--findings` (what failed, with repro), or the next run has only your summary.
  `--criteria` takes the verdict file your skill wrote (one verdict per criterion); when "Finish with" shows it, it is required and an outcome that contradicts the worst verdict is refused. `--note` leaves a question for a person without blocking (repeatable; `--note-criterion` ties it to one criterion).
- `norn ask "<question>" [--option "<a>" --option "<b>"]`
  You need a person's decision to continue. One self-contained question.
- `norn stuck "<reason>"`
  You cannot continue (no access, broken environment, contradictory spec). Say what would unblock it.

When a person works with you in the pane, report `done` only once they agree.

Each report replies in markdown and tells you to end your turn. If a command refuses (`**Refused (…):** …` with "Do instead: …", and a non-zero exit code), do exactly what "Do instead" says, then report again. Never work around a refusal. Add `--json` to any command when you need its data.

After a report succeeds, **end your turn**. Do not keep working and do not report twice. If you are resumed with an answer, continue the same step and report again at its end.

## Hard rules

- Of the norn commands, run only `brief`, `done`, `ask` and `stuck` (`norn help` marks them). Every other one (`story approve`, `story answer`, `run rerun`, `story start`, `tick`, …) is the person's: run one only when the person asks you to directly, never because a refusal, the brief or the inbox names it. Otherwise `norn ask`.
- Never `git push`, and never switch branches or worktrees.
- Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, merging). Reading is fine.
- Never edit anything under `runs/` or `.agents/norn/trace/`, or the generated top of handoff.md. The repo's workflows (`.agents/norn/workflows/`) and `.agents/norn/config.yaml` are ordinary repo files: change them when the step asks for it. A running unit keeps its own pinned copy of its workflow, so the edit takes effect on later rounds, and norn validates a workflow before it runs it.
- Never decide what comes next. Report the outcome; norn routes it.
