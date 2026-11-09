---
id: gh-301
slug: norn-s-agent-instructions-missing
provider: gh
number: 301
url: https://github.com/PruszynskiJakub/norn-next/issues/301
title: "norn's agent instructions: missing reasons, environment, precedence, repetition and preferences, and too much procedure"
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:story
workflow: refinement
status: active
intake_at: 2026-11-09T09:31:42.577Z
body_hash: 329716d682d106f375e4f1b9743bfca38b5fafbe9635e8350d56bb42bfb36e4b
---

## The problem

A review of the instructions norn gives agents (the brief, the `norn` skill, `norn-implement`, `norn-review`, `norn-fsd-round`, and the hooks) looked at them through six lenses: principles over procedures, reasons behind the rules, dynamic boundaries, repeating rules through hooks, preferences, and extensibility. It found seven gaps. Each one leaves the agent guessing in cases the rules don't name, or holds it to a fixed procedure where judgement would serve better.

1. **Most of How to work's hard rules come without a reason** (`packages/core/src/brief.ts`, `protocolLines`). An agent can follow a rule as written but can't judge a case it doesn't cover:
   - "do not survey the repository, `.agents/`, `.claude/` or the machine": is the point context cost, or that the agent would find other units' run state and act on it? The answer decides whether reading a sibling package is allowed.
   - "Of the norn commands, run only `brief`, `done`, `ask` and `stuck`": is a read-only `norn status --json` harmless, or exactly what this rule is meant to stop?
   - "Never edit anything under `runs/`": nothing says that a hand-edited file makes the unit `corrupt`.
   - "Never `git push` (only norn pushes)": this says who pushes, not why (receipts come before effects, so a push outside norn is an effect with no receipt).

   Rules that do carry a reason read well and hold up: "a report can move or remove the folder you stand in", and the handoff's "never as a diary: norn keeps what happened in the receipts".

2. **The agent doesn't know where it runs.** The markdown brief shows the mode only when auto mode fell back to manual (`mode_note`). The runner (a herdr pane or headless) is passed to `where()` only to work out the mode and is never shown. So an unattended agent isn't told that:
   - nobody reads its chat, so a question written there is never seen;
   - in auto mode its report starts the next step at once, so the handoff must stand on its own;
   - a permission prompt parks the step until a person answers it.

   Skills can't fill this in: `norn-implement` says "stop and name the decision needed" without saying where to ask, because the right channel depends on whether the step is attended.

3. **Only one rule is repeated during the session.** The agent adapters receive SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop events, but only Stop answers back (the "report exactly once" block). Rules that run against the model's defaults are stated once in the brief and never again:
   - After compaction or resume (SessionStart with `source` `compact` or `resume`), nothing re-injects the brief. The `norn` skill relies on the agent noticing it lost track.
   - `git push`, switching branches, `gh`/`glab` commands that change the remote, and writes under `runs/` are not stopped while the session runs, only forbidden in text.
   - In an attended step, the longest and most conversational sessions, "report `done` only once they agree" is never repeated.

4. **Nothing says which wins when a skill and How to work clash.** The brief names a step's skill, and a repo's own workflows can name any skill, including third-party ones written without norn in mind. A skill that says "push and open a pull request", "post review comments", "ask the person" or "stop and wait" runs straight into How to work, and nothing says which wins. Precedence is stated only inside review (`REVIEW.md` over the baseline). The rule about other norn commands lists "a refusal, this brief or the inbox" as things that must not prompt a run, but not a skill.

5. **Subagents run without How to work.** `norn-review` runs each axis, and each check of a blocking finding, in its own subagent. `norn-fsd-round` starts one subagent per story. Each gets only the prompt the skill gives it, none of the brief's hard rules. That is fine for a subagent that only reads. A subagent that writes files or runs commands can push, switch branches or run a norn command without ever having been told not to.

6. **Judgement work is written as fixed procedure.** Some instructions have to be exact, because code reads what the agent produces or because they're tuned to the agent tool:
   - the report outcomes, the criteria JSON, the findings JSON, refusals;
   - `norn-fsd-round`'s `160s` / `178000 ms` timeouts, tuned to Claude Code moving a command to the background after about 180 s.

   Others are about judgement but are still written as a fixed procedure. `norn-review` has eight numbered steps, prompts to pass to subagents word for word, and 400-word caps. That leaves the model little room to fit the review to the change in front of it. `norn-implement` shows the better shape: it opens with the failure it prevents ("Without this, code lands before its test…") and ends with the outcome to reach ("Done when…"). The skills follow no shared rule for when to be exact and when to give principles.

7. **A person's preferences don't last.** Channels that work today:
   - `REVIEW.md`, the repo's own rules for review, which override the baseline;
   - documented standards, which override the smell baseline;
   - gate rulings carried forward in the brief ("follow them and do not raise them again"). This records a person's decision without dictating how to act on it.

   But a ruling lasts only for its story and round. "Rejected: I don't want new dependencies" disappears when the story ends, and the next story has to learn it again. `norn-retro` suggests changes only in its reply, so nothing carries a preference from a story's rulings into `AGENTS.md` or `REVIEW.md`.

## What you would like

One change across the brief's protocol, the hooks and the bundled skills:

- **A reason for each hard rule in How to work**, one clause each, saying what breaks if the rule is broken.
- **A "Where you run" section in the brief**, right after the opening line. It is built only from facts norn has (attended or not, the runner, the effective mode, a permission prompt parking the step), and each line states what the fact means for the agent's work, not just a label. For example:

  ```markdown
  ## Where you run

  - Unattended, headless: no person reads this session. Anything you would ask in chat, ask with `norn ask`; it parks the step until answered.
  - Mode auto: when you report, norn starts the next step right away, and the next agent has only the handoff and the receipts.
  - A permission prompt parks the step until a person answers it.
  ```

  `BriefJson.where` gains the runner, so the `--json` brief carries the same facts. The section states only what norn records; for example, it doesn't claim a supervisor will answer an ask.
- **How to work outranks any skill**, stated in the brief, with a short mapping so any skill fits inside a step without knowing about norn:

  | When a skill says | Inside a norn step |
  | --- | --- |
  | ask the person | `norn ask` (in an attended step, ask in the session) |
  | stop, or wait for input | `norn stuck` or `norn ask` |
  | push, open or comment on a pull request | leave it to norn |
  | run another norn command | only when the person asks directly |

  The rule about other norn commands adds "a skill" to what must not prompt one.
- **Hooks that repeat the rules when it matters**:
  - SessionStart with `source` `compact` or `resume` in a unit worktree adds a short note: unit, step, the outcomes the step can report, the hard rules, and "run `norn brief` for the rest".
  - PreToolUse refuses `git push`, branch or worktree switches, `gh`/`glab` commands that change the remote, and writes under `runs/`. The refusal message gives the rule's reason, so the agent learns why when it hits the rule.
  - In an attended step, UserPromptSubmit reminds the agent to report `done` only once the person agrees.

  Each hook keeps `hook.ts`'s existing guarantees: fast, a no-op outside a `.norn-unit` worktree, and any failure answers "allow". An adapter whose agent tool can't inject context or refuse a tool use skips that part.
- **Skills stay unaware of the mode.** The brief adapts them; the bundled skills drop the duplicated protocol lines (e.g. `norn-implement`'s "Commit locally; never push") only where the brief now covers them.
- **Subagents get the rules they need.** A skill that starts a subagent that writes files or runs commands passes it the brief's hard rules, with their reasons. The brief says so too: "A subagent you start works under these rules; give it the ones its work can break." A subagent that only reads needs none.
- **A shared rule for exact versus principled instructions**, written down for the bundled skills (e.g. in `docs/development.md` next to the skill rules):
  - Be exact where code reads what the agent produces (report outcomes, criteria and findings JSON) or where it is tuned to the agent tool (`norn-fsd-round`'s timeouts).
  - Elsewhere, state the failure the skill prevents and the outcome to reach. Give principles with their reasons, and keep numbered steps only where order matters.
  - Apply it to `norn-review` first: keep the two axes, the traceability table, the findings JSON and the checks of blocking findings, and turn the fixed subagent prompts and word caps into what each axis must cover and why. The repo has no evaluation of review quality, so show the rewrite loses nothing by reviewing a few past diffs (one with a known blocking finding, one clean) with the old skill and the new one, and comparing the findings.
- **Preferences outlast the story.** `norn-retro` lists the story's gate rulings and asks findings that read as a lasting preference. For each, it proposes the line to add to `AGENTS.md` or `REVIEW.md` (the file and section, and the wording, with the ruling it came from). It still changes no file; the person adds the lines they accept, so the next story's brief and review pick them up.

## Anything else

- Changes the brief's JSON contract (`BriefJson.where`) and the hook responses; their tests and every user change with them.
- Edits bundled skills in `packages/cli/assets/skills/`, never their `.agents/skills/norn*` copies.
- Large enough to slice. The brief and hook parts (reasons, Where you run, precedence, subagents, hooks) are independent of the skill parts (exact versus principled, `norn-review`, `norn-retro`).
