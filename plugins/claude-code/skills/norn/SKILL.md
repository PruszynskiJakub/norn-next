---
name: norn
description: The protocol for doing one norn step and reporting it. Use when a session starts with "Use the norn skill, then run `norn brief`", when the working directory contains a `.norn-unit` file, or when asked to pick up, continue or report norn work. Covers reading the brief, staying in scope, keeping handoff.md current, and reporting exactly once with `norn done`, `norn ask` or `norn stuck`.
---

# norn: one step, one report

You do exactly one step of a larger delivery and report how it ended. Code decides what happens next. You never pick, name or skip steps.

## 1. Read the brief

Run `norn brief` in this worktree (`norn brief --json` for data). It gives:

- **Where you are**: story, slice, step, attempt, mode, whether a person works with you.
- **The skill to use**: load it and follow it for the craft. Extra instructions add to it.
- **Inputs**: spec, slice file, diff range. Read them before you change anything.
- **Rework**: when present, these points come before anything else.
- **Context**: handoff.md and any answer to an earlier question.
- **Finish with**: the outcomes you may report and what each one means.
- **Limits**: deadline, nudges left, port slot.

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

Update it at each milestone and always right before you report.

## 4. Report exactly once, then end your turn

Pick exactly one:

- `norn done <outcome> --handoff "<short summary>" [--findings <file>] [--evidence <dir>]`
  The outcome must be one listed under "Finish with". Pick the one whose meaning is true, not the one you hoped for. Pass the findings file or evidence directory your skill produced.
- `norn ask "<question>" [--option "<a>" --option "<b>"]`
  You need a person's decision to continue. One self-contained question.
- `norn stuck "<reason>"`
  You cannot continue (no access, broken environment, contradictory spec). Say what would unblock it.

When a person works with you in the pane, report `done` only once they agree.

Every command prints JSON. If it refuses (`{"error", "do_instead"}`), do exactly what `do_instead` says, then report again. Never work around a refusal.

After a report succeeds, **end your turn**. Do not keep working and do not report twice. If you are resumed with an answer, continue the same step and report again at its end.

## Hard rules

- Never `git push`, and never switch branches or worktrees.
- Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, merging). Reading is fine.
- Never edit anything under `runs/`, the generated top of handoff.md, or files in `.agents/norn/`.
- Never decide what comes next. Report the outcome; norn routes it.
