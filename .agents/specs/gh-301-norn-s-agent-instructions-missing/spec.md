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
  - norn:wf:refinement
workflow: refinement
status: active
intake_at: 2026-11-09T09:31:42.577Z
body_hash: 329716d682d106f375e4f1b9743bfca38b5fafbe9635e8350d56bb42bfb36e4b
---

# norn's agent instructions: missing reasons, environment, precedence, repetition and preferences, and too much procedure

## Problem Statement

An agent working a norn step gets its rules from the brief, the step's skill and the hooks. A review of those instructions found seven gaps, and each one leaves the agent guessing where the rules are silent:

- **Rules without reasons.** Most of How to work's hard rules give no reason. An agent can follow "do not survey the repository" or "run only `brief`, `done`, `ask` and `stuck`" as written, but it can't tell whether reading a sibling package or a read-only `norn status --json` is what the rule forbids. It isn't told that a hand-edited run state file makes the unit `corrupt`, or that a push outside norn is an effect with no receipt.
- **No sense of where it runs.** The brief shows the mode only when auto fell back to manual, and never shows the runner. An unattended agent isn't told that nobody reads its chat, that in auto mode its report starts the next step at once, or that a permission prompt parks the step. So a question written in chat is never seen, and a skill's "stop and name the decision" has no channel.
- **Rules said once.** Only the end-of-turn hook answers back. After compaction or resume nothing re-orients the agent. Pushes, branch switches, remote-changing `gh`/`glab` commands and run state edits are forbidden only in text. In attended steps, "report `done` only once they agree" is never repeated, and those are the longest sessions.
- **No precedence.** When a skill (often a third-party one) says "push and open a pull request", "ask the person" or "stop and wait", nothing says whether the skill or How to work wins.
- **Subagents get no rules.** A subagent that a skill starts sees only the skill's prompt. One that runs commands can push or run a norn command without ever having been told not to.
- **Judgement written as procedure.** `norn-review` has numbered steps, word-for-word subagent prompts and word caps, which leave the model little room to fit the review to the change. No shared rule says when a skill must be exact and when it should give principles.
- **Preferences don't last.** A person's gate ruling ("no new dependencies") binds only its story and round. The next story has to learn it again, and `norn-retro` gives the agent no way to turn a ruling into a lasting line.

## Solution

One change across the brief, the hooks and the bundled skills:

- How to work gives **a reason for each hard rule**, one clause saying what breaks.
- The brief opens with **Where you run**: lines built only from facts norn records (attended or not, the runner, the effective mode, the auto-without-runner fallback, a permission prompt parking the step), each saying what the fact means for the work. It replaces today's lone mode line and the "Attended step" banner. The `--json` brief gains the runner.
- The brief says **How to work outranks any skill** and includes a four-row mapping from what a skill says to what to do inside a step.
- **Hooks repeat the rules when it matters:** a re-orientation note after compact, resume or clear; refusal of pushes, branch and worktree switches, remote-changing `gh`/`glab` commands and file-tool writes under run state, each with the rule's reason; a one-line reminder on every prompt of an attended step. The hooks are a reminder, not a sandbox: they fail open.
- **Subagents get the rules their work can break**, as the brief says and `norn-review` does.
- **A shared rule for exact versus principled instructions** goes into the contributor docs. `norn-review` is rewritten to follow it, and a before/after comparison on past diffs shows the rewrite loses nothing.
- **`norn-retro` proposes lasting lines** for `REVIEW.md` or the repo's agent instructions file from the story's gate rulings. It still changes no file.

## User Stories

### Reasons in How to work

1. As an agent in a norn step, I want the rule against surveying the repository, `.agents/`, `.claude/` or the machine to say why (the brief already holds what the step needs, a survey spends context on what it doesn't, and other units' run state and handoffs are not mine to act on), so that I know reading a sibling package my change calls is allowed and browsing other units' specs or the machine directory is not.
2. As an agent, I want the rule that I run only `brief`, `done`, `ask` and `stuck` to say why (the brief carries this unit's state, rendered fresh each time; other norn commands drive units and gates that are the person's, or show other units' state, which is not mine to act on), so that I know a read-only `norn status --json` or `norn story view` is forbidden too.
3. As an agent, I want the rule never to edit run state under `runs/` to say that a hand-edited file fails validation and makes the unit `corrupt`, so that I don't "fix" a state file by hand.
4. As an agent, I want the rule never to `git push` to say that a push outside norn is an effect with no receipt, because receipts come before effects, so that I understand why only norn pushes.
5. As an agent, I want the rule never to switch branches or worktrees to say that it takes me off the unit's branch, where norn commits what is left when I report, so that I stay put.
6. As an agent, I want every other hard rule in How to work to carry its one-clause reason too, so that no hard rule reaches me bare.
7. As an agent, I want the rule on other norn commands to name "a skill" among the things that must not prompt one, next to a refusal, the brief and the inbox, so that a skill telling me to run `norn …` doesn't override it.

### Where you run

8. As an agent, I want the brief to open with a "Where you run" section right after its opening line, in every step, attended or not, so that I know my situation before I read my work.
9. As an agent in an attended step, I want Where you run to tell me that a person works with me in this session, that I ask them here, and that I report `done` only once they agree, so that I don't park the step with `norn ask` while the person is right there.
10. As an unattended agent, I want Where you run to name my runner (a herdr pane or headless) and tell me that no person reads this session and that anything I would ask in chat goes through `norn ask`, which parks the step until it is answered, so that my questions are seen.
11. As an agent in auto mode, I want Where you run to tell me that my report starts the next step at once and that the next agent has only the handoff and the receipts, so that I write a handoff that stands on its own.
12. As an agent in manual mode, I want Where you run to tell me that after my report the next step waits for a person to start it, so that I know what my report sets off.
13. As an agent whose story asked for auto but whose machine has no runner, I want Where you run to say that the step runs manual for that reason and what that means for my report, so that the fallback is explained, not just labelled.
14. As an agent, I want Where you run to tell me that a permission prompt parks the step until a person answers it, so that I avoid actions that would prompt when I can.
15. As an agent, I want Where you run to replace today's separate mode line and "Attended step" banner, so that these facts appear in one place and never disagree.
16. As an agent or front end reading `norn brief --json`, I want the brief's `where` to carry the runner alongside attended and the mode, as facts with no rendered prose, so that the JSON brief holds the same facts as the markdown one.
17. As a person reading a brief, I want Where you run to state only what norn records (for example, it never claims a supervisor will answer an ask), so that the brief never promises what norn can't keep.

### Precedence over skills

18. As an agent, I want How to work to say it outranks any skill, so that I know which wins when a skill and the brief clash.
19. As an agent running a skill written without norn in mind, I want How to work to map what a skill says to what to do in a step, so that any skill fits inside a step: "ask the person" → `norn ask` in an unattended step, or ask in the session in an attended one; "stop, or wait for input" → `norn stuck` or `norn ask`; "push, open or comment on a pull request" → leave it to norn; "run another norn command" → only when the person asks directly.
20. As an agent, I want the "ask the person" row rendered for my step, so that the mapping never contradicts Where you run.

### Hooks

21. As an agent whose session was compacted, resumed or cleared in a unit worktree, I want a short note added at session start (the unit, the step, the outcomes it can report, the hard rules with their reasons, and "run `norn brief` for the rest"), so that I'm re-oriented without having to notice I lost track.
22. As an agent starting a fresh session, I want no such note at start-up, so that it doesn't repeat the brief I'm about to read.
23. As an agent in any step, attended or not, I want a `git push` refused with the rule's reason ("only norn pushes, because receipts come before effects; if you want this pushed, run it yourself"), so that I learn why when I hit the rule.
24. As an agent, I want a branch or worktree switch refused with its reason, so that I stay on the unit's branch.
25. As an agent, I want `gh` and `glab` commands that change the remote refused with the rule's reason, judged against a list of known writes (creating, editing, commenting on, reviewing, readying, merging, closing or reopening pull requests, merge requests and issues; labels; creating or deleting releases; editing or deleting the repo; and `api` calls with a method other than GET or with field or input flags), so that the remote changes only through norn.
26. As an agent, I want every `gh` or `glab` command not on that list allowed, reads included (`view`, `list`, `status`, `diff`, `checks`, GET `api`), so that the triage and review work that reads through them is never blocked.
27. As an agent, I want a file-tool write whose path resolves under the run state directory refused with the reason that a hand-edited file makes the unit `corrupt`, while reads and shell commands are not inspected, so that the common way of hand-editing state is caught.
28. As an agent in an attended step, I want one short line added to every prompt the person sends, reminding me to report `norn done` only once the person agrees the work is finished, and to ask in this session rather than with `norn ask`, so that the rule stays fresh in long conversational sessions.
29. As an agent, I want these hooks to refuse the same call again each time I retry it, with no cap like the end-of-turn hook's, so that a refusal never runs out (each one refuses only that call and never holds the session).
30. As a person, I want every hook to stay fast, to do nothing outside a unit worktree, and to answer "allow" on any failure of its own, so that norn's hooks never get in my way outside norn or break a session.
31. As a person using an agent tool that can't add context or refuse a tool use, I want the hook to skip that part and keep doing the rest, so that the tool works as before.
32. As a person with norn already installed, I want the new hook answers to take effect without reinstalling the hooks, where the hooks for these events are already installed, so that upgrading is enough.
33. As a reader of the docs, I want them to say that the hooks are a reminder, not a sandbox, and that what they miss is still forbidden by the brief, so that nobody treats them as a security boundary.

### Subagents

34. As an agent, I want How to work to say that a subagent I start works under these rules, that I give it the ones its work can break with their reasons, and that one that only reads needs none, so that the rules reach every agent that acts in the step.
35. As a person, I want `norn-review` to give any subagent that runs commands (an axis that runs the suite, a check of a blocking finding that tries the input) the rules its work can break (no push, no branch or worktree switch, no norn command, no writes under run state), each with its reason, so that a review subagent can't break them unknowingly.

### Exact versus principled instructions

36. As a contributor writing a bundled skill, I want the contributor docs to state when a skill must be exact (where code reads what the agent produces, such as report outcomes and the criteria and findings JSON, or where it is tuned to the agent tool, such as `norn-fsd-round`'s timeouts) and that everywhere else it states the failure it prevents and the outcome to reach, gives principles with their reasons, and keeps numbered steps only where order matters, so that every skill follows one rule.
37. As a person, I want `norn-review` rewritten to that rule, keeping the two axes, the traceability table, the findings JSON and the checks of blocking findings, and turning its fixed subagent prompts and word caps into what each axis must cover and why, so that the review fits the change in front of it.
38. As a person, I want the rewrite shown to lose nothing: at least two past diffs reviewed with the old skill and the new one. On a diff whose review raised a blocking finding that held, the new skill raises the same defect (the wording may differ); on a diff that review passed clean, it raises no blocking finding. Differences in non-blocking findings are noted but don't fail the comparison. The results go in the step's evidence and the PR's before/after evidence, so that I can judge the rewrite without a review-quality eval.
39. As a person, I want the bundled skills to drop protocol lines only where the brief now covers them (for example, `norn-implement`'s "Commit locally; never push"), and to stay unaware of the mode, so that the brief alone adapts them to the step.

### Lasting preferences

40. As a person running a retro, I want `norn-retro` to list the story's gate rulings and ask which of them read as a lasting preference, so that a decision I made once isn't lost when the story ends.
41. As a person, I want `norn-retro` to propose a line for `REVIEW.md` for a ruling about how code is judged (for example, "no new dependencies"), so that the next review picks it up as overriding the baseline.
42. As a person, I want `norn-retro` to propose a line for the repo's agent instructions file (`AGENTS.md`, or `CLAUDE.md` when that is what the repo has) for a ruling about how agents work, so that the next story's agents follow it.
43. As a person, I want each proposal to name the file, the section, the wording, and the ruling it came from (the gate, the round and my words), so that I can accept it without digging.
44. As a person whose repo lacks the target file, I want `norn-retro` to say so and propose creating it with that line, so that a missing file doesn't drop the preference.
45. As a person, I want `norn-retro` not to propose a preference the file already states, but to cite the existing line as evidence that the ruling repeated a known rule, so that the files don't fill with duplicates.
46. As a person, I want `norn-retro` still to change no file, so that I add only the lines I accept.

## Out of Scope

- Rewriting bundled skills other than `norn-review` to the exact-versus-principled rule: each one needs its own before/after comparison, and doing several at once hides which change cost what. A later story.
- Passing How to work to `norn-fsd-round`'s subagents: it runs from the main checkout, outside a step, and its subagent brief is its own rule set.
- Inspecting shell commands for writes under run state: guessing at shell writes is unreliable, and the hooks are a reminder, not a sandbox.
- Hook enforcement of the rule against other norn commands: it is taught by its reason, not refused.
- An automated review-quality eval: the comparison on past diffs is evidence for this change, not a repo test.
- A re-orientation note at session start-up: the session's first prompt already runs `norn brief`.

## Further Notes

- Answered by a delegate of Jakub, who chose to combine all seven gaps into one issue on purpose.
- Slice along the line the issue draws: brief and hooks (reasons, Where you run, precedence, subagents, hooks) are independent of skills (exact versus principled, the `norn-review` rewrite and comparison, `norn-retro`). The skill lines dropped must be exactly those the brief now covers.
- Changes the brief's JSON contract and the hook answers; their tests and every user change with them. Bundled skills are edited at their source, never their installed copies.

