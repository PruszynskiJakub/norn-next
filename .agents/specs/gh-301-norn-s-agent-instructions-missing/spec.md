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
refined_body_hash: 329716d682d106f375e4f1b9743bfca38b5fafbe9635e8350d56bb42bfb36e4b
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


## Plan

### Seams

- **S1 The brief renderer, through `renderBrief` (its markdown and its `BriefJson`).** Observes the reasons in How to work, Where you run in every situation, precedence and the skill mapping rendered per step, the subagent rule, and the `where` facts of the `--json` brief.
  Prior art: core's `brief.test.ts` (`renderBrief` over fixture state, receipts and workflows, with snapshots), and the protocol pins in cli's `assets.test.ts`.
- **S2 A pure hook-answer function in core, through its input (the unit's session, the hook fact, the normalized tool call, the facts the cli gathered) and its answer.** Observes the session-start note, the refusals of pushes, branch and worktree switches, remote-changing `gh`/`glab` commands and file writes under run state, each with its reason; reads and unlisted commands allowed; the attended reminder; no cap on refusals; the existing turn-end block.
  Prior art: none at this seam (the decision lives in the cli `hook` command today); the block cases in cli's `agent-protocol.test.ts` and `stop-block-cap.test.ts` are the behaviour it keeps.
- **S3 `norn hook` through the cli harness.** Observes the wiring end to end: no-op outside a unit worktree, "allow" on any failure of its own, the new answers working with the hooks already installed, one case per answer kind, and tool refusals not spending the turn-end cap.
  Prior art: `agent-protocol.test.ts` (its "norn hook robustness" and "attended steps never block" blocks) and `stop-block-cap.test.ts`.
- **S4 Each agent adapter, through `hookResponse` and the new `toolCall`.** Observes how Claude, Codex and Gemini encode a denial and added context, how each tool's native call becomes a shell command or a file write, and that an adapter unable to encode an answer emits allow (OpenCode).
  Prior art: the adapters' `claude.test.ts`, `codex.test.ts` and the Gemini and OpenCode unit tests, over recorded `hook-payloads.json` fixtures.
- **S5 Skill and doc text, through the term pins in `assets.test.ts`, the docs lint and review.** Observes the rewritten `norn-review` (its kept contracts and its subagent rules), the `norn-retro` preferences, the dropped skill lines, the exact-versus-principled rule in the contributor docs, and the docs saying the hooks are a reminder, not a sandbox. The `norn-review` before/after comparison on past diffs is QA by an agent.
  Prior art: `assets.test.ts` ("norn-fsd-round states the supervisor protocol", "the norn skill sends the agent to the brief"); the docs lint in `test/repo/docs.test.ts`.

### Coverage

| User story | Seam | Test kind | Notes |
|---|---|---|---|
| the no-survey rule says why | S1 | unit | rendered from the one rules list |
| the only-four-commands rule says why, read-only commands included | S1 | unit | |
| the run state rule says a hand edit makes the unit `corrupt` | S1 | unit | |
| the no-push rule says a push has no receipt | S1 | unit | |
| the no-switch rule says it leaves the unit's branch | S1 | unit | |
| every other hard rule carries its reason | S1 | unit | every entry of the rules list has a reason |
| the other-commands rule names a skill among what must not prompt one | S1 | unit | |
| Where you run opens every brief | S1 | unit | |
| attended: the person is here, ask here, done once they agree | S1 | unit | |
| unattended: names the runner, nobody reads chat, ask via `norn ask` | S1 | unit | |
| auto: the report starts the next step; the handoff must stand alone | S1 | unit | |
| manual: the next step waits for a person | S1 | unit | |
| auto without a runner: runs manual, and what that means | S1 | unit | from `mode_requested` ≠ `mode` |
| a permission prompt parks the step | S1 | unit | unattended steps only |
| Where you run replaces the mode line and the Attended banner | S1 | unit | also the banner pin in `agent-protocol.test.ts` |
| `--json` brief carries the runner, facts only | S1 | unit | `mode_note` gone |
| Where you run states only what norn records | S1 | unit | each line maps to a `where` fact; review checks the wording |
| How to work outranks any skill | S1 | unit | |
| the four-row skill mapping | S1 | unit | |
| the "ask the person" row rendered for the step | S1 | unit | attended and unattended snapshots |
| a re-orientation note after compact, resume or clear | S2 | unit | plus one S3 case and S4 encoding |
| no note at start-up | S2 | unit | |
| `git push` refused with its reason | S2 | unit | plus one S3 case |
| branch or worktree switch refused with its reason | S2 | unit | the rev-parse fact given as input |
| remote-changing `gh`/`glab` refused, judged against the list | S2 | unit | |
| unlisted `gh`/`glab` commands allowed, reads included | S2 | unit | |
| file-tool writes under run state refused; reads and shell not inspected | S2 | unit | path resolution in S3 |
| attended reminder on every prompt | S2 | unit | plus S4 encoding |
| refusals repeat with no cap | S2 | unit | S3: the turn-end cap untouched by tool refusals |
| fast, no-op outside a unit, allow on own failure | S3 | integration | |
| an agent tool that cannot refuse or add context skips that part | S4 | unit | OpenCode fixture |
| already-installed hooks take the new answers without reinstall | S3 | integration | hooks installed as `norn init` writes them today |
| docs say the hooks are a reminder, not a sandbox | S5 | review | `docs/limitations.md` entry rewritten; docs lint |
| How to work's subagent rule | S1 | unit | |
| `norn-review` gives command-running subagents their rules | S5 | unit | term pins |
| the exact-versus-principled rule in the contributor docs | S5 | review | Development › Skills |
| `norn-review` rewritten to the rule, contracts kept | S5 | unit | term pins for the axes, table, findings JSON and checks of blocking findings; review |
| the rewrite shown to lose nothing on past diffs | S5 | QA (agent) | old and new outputs in the step's evidence and the PR |
| skills drop only lines the brief covers, and stay mode-unaware | S5 | unit | pins that the dropped lines stay gone |
| `norn-retro` lists gate rulings and asks which last | S5 | unit | term pins; review |
| a `REVIEW.md` line for a ruling on how code is judged | S5 | unit | term pins; review |
| an agent instructions file line for a ruling on how agents work | S5 | unit | term pins; review |
| each proposal names file, section, wording and ruling | S5 | unit | term pins; review |
| a missing target file: propose creating it | S5 | review | |
| a preference already stated: cite it, no duplicate | S5 | review | |
| `norn-retro` still changes no file | S5 | unit | existing pin kept |

### Prefactoring

1. **One list of the hard rules, in core**, each entry with its rule text and the reason it holds, from which How to work renders exactly as today (the reasons are empty until the change lands). It makes the reasons in How to work, the session-start note and the refusal reasons one text, so the brief and the hooks never word a rule two ways.
2. **Move the turn-end block decision from the cli `hook` command into a pure hook-answer function in core.** Taking one of the capped refusals stays in the cli as the last gate, after core says the turn end would be blocked. It gives S2 its seam, so every new hook answer is a unit test.
3. **`protocolLines` takes the step** (today only the handoff path), so How to work can render the "ask the person" row for an attended or an unattended step.

No general shell parser: the refusals judge each command segment with a small tokenizer that lives with them.

### Implementation decisions

- D1 **`where` in the JSON brief replaces `mode_note` with `mode_requested`** (the story's mode before the fallback) **and gains `runner`** (`herdr`, `headless` or null). Facts only, as the machine contract asks; the markdown renders the fallback's meaning. Nothing outside the brief and its test reads `mode_note`.
- D2 **Where you run** is a section right after the brief's opening line, built from `attended`, `mode`, `mode_requested` and `runner`. Attended: the person works here, ask here, report `done` once they agree. Unattended: the runner, nobody reads this session, ask with `norn ask` (it parks the step), and a permission prompt parks the step until a person answers. Auto: the report starts the next step at once and the next agent has only the handoff and receipts. Manual: the next step waits for a person. Fallback: auto was asked, no runner, so it runs manual. It replaces the "Attended step" banner and the mode line; the at-limit counter line stays where it is.
- D3 **How to work** gains the reason on every hard rule (from the rules list), "How to work outranks any skill" with the four-row mapping (its "ask the person" row reads "ask in this session" when attended and "`norn ask`" when not), "a skill" among what must not prompt another norn command, and the subagent rule: a subagent works under these rules, gets the ones its work can break with their reasons, and one that only reads needs none.
- D4 **The hook answer** becomes one of: allow, block the turn end (with its reason), deny the tool call (with its reason), add context (with its text). It replaces `HookDecision`; each adapter's `hookResponse` encodes what its tool supports and emits allow for the rest. Claude: PreToolUse `permissionDecision: deny`, SessionStart and UserPromptSubmit `additionalContext`. Codex: the same shape on its PreToolUse, SessionStart and UserPromptSubmit. Gemini: BeforeTool `decision: deny`, SessionStart and BeforeAgent `additionalContext`. OpenCode (`hooks` tier): allow only.
- D5 **A pure `toolCall(native, payload)` port method on the agent adapter** returns a shell command (in full) or a file write (its paths), or null. Claude: `Bash`; `Write`, `Edit`, `MultiEdit`, `NotebookEdit`; `EnterWorktree` as a worktree switch. Codex: its shell tool; `apply_patch`'s file paths. Gemini: `run_shell_command`; `write_file`, `replace`. It is not persisted: `HookFact` and the trace schema stay unchanged, because `HookFact.command` is a 300-character summary that can hide a push past its cut.
- D6 **Refused shell commands**, judged per segment (split on `;`, `&&`, `||`, `|` and newlines; leading env assignments and `git -C <dir>`/`-c k=v` options skipped): `git push`; `git switch`; `git checkout` with `-b`, `-B`, `--orphan` or `--detach`; `git checkout -`; `gh pr checkout`; `glab mr checkout`; `git worktree add|move|remove`; a bare `git checkout <name>` only when the cli's one `git rev-parse --verify --quiet <name>^{commit}` resolves it and no `--` follows (the cli gathers that fact; core decides). Anything the tokenizer cannot read is allowed.
- D7 **The `gh`/`glab` write list** is the spec's: create, edit, comment, review, ready, merge, close, reopen on pull requests, merge requests and issues; labels; release create and delete; repo edit and delete; `api` with a method other than GET or with field or input flags (`-f`, `-F`, `--field`, `--raw-field`, `--input`). Every other subcommand is allowed.
- D8 **A file write is refused when its path resolves under the checkout's whole `runs/` folder** in the machine dir. The cli resolves it (relative to the payload's cwd, the nearest existing parent through realpath) and passes it in; another unit's state is just as off limits.
- D9 **Tool refusals are traced as `blocked` with their reason; the turn-end cap counts only `turn_end` lines.** `blockedHookCount` filters on the fact's event. No trace schema change, and a refusal stays visible in the trace.
- D10 **The session-start note** is added for any session source but start-up (Claude's compact, resume and clear; Codex's and Gemini's equivalents): the unit, the step, its reportable outcomes, the hard rules with their reasons, and "run `norn brief` for the rest". It needs a unit worktree with a loadable state at an agent step; otherwise allow.
- D11 **The attended reminder** is one line added on each prompt only while the cursor is at an attended agent step: report `norn done` once the person agrees the work is finished, and ask in this session rather than with `norn ask`.
- D12 **Refusals apply in attended and unattended steps alike**, need a loadable unit session, and fail open: any error in gathering facts or deciding answers allow.
- D13 **Docs**: `docs/limitations.md`'s "No hard-deny hook" entry becomes "the hooks are a reminder, not a sandbox", naming what they miss (shell writes under run state, unlisted remote writes, other norn commands) as still forbidden by the brief. The exact-versus-principled rule goes into Development › Skills.
- D14 **`norn-review`** is rewritten to the rule: it keeps the two axes, the traceability table, the findings JSON, the checks of blocking findings and `REVIEW.md`'s precedence, and turns its fixed subagent prompts and word caps into what each axis must cover and why. Any subagent that runs commands is given no push, no branch or worktree switch, no norn command and no writes under run state, each with its reason.
- D15 **The skill lines dropped** are exactly: "never push" in `norn-implement` and `norn-merge` ("Commit locally" stays, as craft); "Never push." in `norn-diagnose`; "Never create or switch branches for it." in `norn-prototype`. No bundled skill names the mode.
- D16 **`norn-retro`** gains a section after the friction: list the story's gate rulings (`approve` and `reject` comments with gate, round and words; delegated ones marked), ask which read as lasting, and propose for each a line for `REVIEW.md` (how code is judged) or the repo's agent instructions file (`AGENTS.md`, else `CLAUDE.md`, how agents work), naming the file, section, wording and source ruling; propose creating a missing file; cite an existing line instead of duplicating it. It still writes no file.
- D17 **The before/after comparison** is QA by an agent: it runs the old and new `norn-review` on at least two past diffs from merged stories' delivery records — one whose review raised a blocking finding that held and was fixed in rework, one that review approved clean — and passes when the new skill raises the same defect on the first and no blocking finding on the second. Non-blocking differences are noted. Both outputs go in the step's evidence, and the PR's before/after evidence. Jakub reviews at the PR.

### Testing decisions

A good test drives the seam's public interface and asserts what an agent or the agent tool would see: the brief's text and JSON, the hook's answer, the bytes an adapter writes. Never the rules list's internals or the tokenizer directly; the tokenizer is covered through S2's answers on whole commands. Core's tests build session, fact and tool call from the existing fixtures and `@norn/schema` shapes. The git `rev-parse` result and the resolved run state path are facts passed into S2, so S2 needs no git or file system; S3 exercises them for real in the harness. The agent tools' payloads are a system boundary: S4 uses recorded fixtures, extended with PreToolUse, SessionStart and UserPromptSubmit payloads per tool. Brief snapshots change only for the intended Where you run and How to work text; review reads that snapshot diff. Skill text is pinned by terms, not whole files.

### Risks

- **Codex's and Gemini's hook outputs** for deny and added context are taken from their docs, not observed; a wrong shape is silently ignored (fail open), so the rule stays text-only there. The slice building S4 records real payloads where it can and says in the handoff which encodings are unobserved.
- **False refusals** in the shell tokenizer (a `git push` inside a quoted string or a heredoc) block legitimate work. The tokenizer errs toward allow; S2's cases include quoted and compound commands.
- **The trace's `blocked` lines** are read by more than the cap (silent classification, `norn run list`); a tool refusal traced `blocked` could be misread as a turn-end block. The slice changing the cap checks every reader of `blocked`.
- **Hook latency**: the rev-parse call and realpath run on every matching tool call; both are bounded to the commands that need them.
