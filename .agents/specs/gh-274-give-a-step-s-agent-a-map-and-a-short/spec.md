---
id: gh-274
slug: give-a-step-s-agent-a-map-and-a-short
provider: gh
number: 274
url: https://github.com/PruszynskiJakub/norn-next/issues/274
title: Cap what the brief pastes, cut AGENTS.md to a map, and start agents with the brief
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:refinement
workflow: refinement
status: dropped
intake_at: 2026-11-07T10:20:30.339Z
body_hash: f73af2f6849a9237787baed9c2cde3b26510eabe4887154473a497e929adc4ff
refined_body_hash: b2602b599264402664956616635e6f81374086e676888e0b2632baeddffbb2ae
---

# Give a step's agent a map and a short brief, and keep norn's own state out of its context

## Problem

A step's agent spends its first turns, and much of its context, on things that do not help the step. Measured on norn 0.25.0 in this repo (43 step sessions, 666 stored briefs):

- Every session starts at about 54k tokens. AGENTS.md (3.7k words) is mostly maintainer reference a step never needs. Most of the rest is the person's own user-level setup: personal skills, plugins and MCP servers for mail, calendar and time tracking.
- Four hops before the work starts: the launch prompt names the norn skill, the skill says to run `norn brief`, the brief names the step skill, the step skill names the inputs. The skill and the brief both explain how to report, how to resume, run state and pushing.
- The brief is mostly norn's own state: every counter of the workflow, the mode, the run id, the deadline, nudges, retries, the port slot, and a paragraph of explanation for rulings repeated in every brief. It pastes the handoff whole: one 3.4 MB handoff produced a brief of about 496k words.
- There is no map, so agents explore: in one session ten tool calls came before the first edit (re-reading the issue the spec mirrors, grepping the rules file for ids, listing a doc that does not exist, hunting for a source file and its tests).
- The handoff is one growing file per unit that every step and norn write into. The same story is told in the handoff, in each report's summary and in the progress lines norn appends, and norn's appended lines can duplicate a section (#273).
- `.agents/RULES.md` (19.8k words) is cited by id across code comments, together with story and review ids. An agent has to look each one up and learns nothing about why the code is so.

Nobody can see how much of this orientation each step costs, so no change to it can be judged.

## Solution

The guiding rule: each change removes more context and machinery than it adds.

- The first prompt is one line: run `norn brief` and do what it says. The brief holds the step's work, the person's words, references to the files it may need (path plus what kind of file it is, never their content), the protocol once, and how to finish. norn's own state shows only when it changes what the agent should do.
- AGENTS.md is a map of 500 words or fewer; the detail it holds today moves to `docs/dev/`, opened on demand.
- `.agents/RULES.md` goes. The few invariants that must not break are stated once in plain sentences in the developer docs; what norn does for a user lives in the user docs; what a change must do lives in its spec and tests. Comments explain why, never cite ids.
- The norn skill shrinks to a fallback for manual sessions; workflow instructions keep only what is specific to their step.
- A Claude step session starts with the project's settings and MCP servers only, not the person's.
- The handoff becomes the unit's journal: norn appends one short entry per report and per person's decision; the agent no longer edits it.

## Behaviour

### Orientation metrics

B1–B6 were dropped at plan (see Out of scope); their ids are not reused.

### The brief

- B7 As a step's agent, I want "Where you are" to show only what changes my work, so that norn's own state stays out of my context.
  Example: a first attempt of `implement` shows the story and the step only; no run id, mode, port slot or counters.
- B8 As a step's agent on a second or later attempt, I want the attempt number shown.
  Example: a retry shows `Step: implement (attempt 2)`; attempt 1 shows no number.
- B9 As a step's agent in a fix round, I want the last outcome and only the counter of the loop that sent the work back.
  Example: review sent the work back for the second time → `Last outcome: review → changes` and `review_loop 2/3`; no other counters.
- B10 As a step's agent in an attended step, I want one instruction line instead of a mode field.
  Example: `A person is with you in this session: agree each decision with them, and report done only once they agree.`
- B11 As a step's agent, I want Limits shown only when one is close.
  Example: on the last fresh-session retry, with at most one nudge left, or with under 20% of the deadline left, Limits shows that limit; otherwise the section is absent.
- B12 As a step's agent, I want the brief to reference files instead of pasting them, each with a short generic description of what that kind of file holds, so that a large file never fills my context.
  Example: Inputs lists `spec.md — the story spec: problem, solution, numbered behaviour items`, `handoffs/_story.md — journal: what earlier steps did and decided, newest last`; none of their text is in the brief.
- B13 As a step's agent sent back by review or QA, I want Rework first, listing each finding with its file and line, then the findings file.
  Example: `Rework` lists `blocking · packages/x.ts:42 · missing refusal on empty name` and ends with `full findings: <path>`.
- B14 As a step's agent sent back by a failing check, I want the check, its command and a reference to its log, not the log text.
  Example: `test failed: bun run test — log: <path> (output of the failing check command)`.
- B15 As a step's agent, I want a person's own words shown inline: an answer to my ask, a note on the story and a gate ruling with its reason.
  Example: a person answered "keep the old flag as an alias" → the brief quotes that answer under Context.
- B16 As a step's agent, I want rulings introduced by one line, not a repeated paragraph.
  Example: `Gate decisions a person made on this story; follow them.` followed by the rulings.
- B17 As a step's agent, I want no list of code files in the brief; the map in AGENTS.md is how I find code.
  Example: an `implement` brief has no code paths under Inputs.
- B18 As a program, I want `norn brief --json` to keep every field it has today, so that only the markdown an agent reads is trimmed.
  Example: `--json` still carries run id, mode, every counter and every limit.
- B19 As a person, I want the stored brief of each run to be exactly what the agent got.
  Example: `norn run view <run>` shows the trimmed brief with references, not pasted files; a huge handoff no longer makes a huge stored brief.
- B48 As a step's agent, I want the brief in a fixed order: my work and why this attempt (or the rework), then "Finish with", then the inputs as references, then a person's words and rulings, so that what to do comes first and repeated launches share a stable prefix.
  Example: a review fix round opens with Rework, then the outcomes, then Inputs, then Context with the person's answer.
- B49 As a step's agent, I want an evidence folder referenced as a folder with its file count, never one line per file.
  Example: `evidence/qa/ — 14 files: screenshots and logs QA collected`.

### Starting a step and one home per instruction

- B20 As a step's agent launched by norn, I want a one-line first prompt, ``Run `norn brief` in this worktree and do what it says.``, so that I start on the brief without loading a skill first.
  Example: in auto mode the session's first prompt is that line; the agent's `norn brief` prints the work.

- B21 As a person starting an attended step, I want the start command to use the same one-line prompt.
  Example: `norn story start gh-274 --print` prints a command whose prompt is ``Run `norn brief` in this worktree and do what it says.``, not "Use the norn skill, then run `norn brief`".

- B22 As a step's agent, I want the protocol stated once, in the brief: the outcomes to finish with, plus three lines (report exactly once then end the turn; never push or switch branches; never edit norn's run state).
  Example: the brief's "Finish with" section (placed as B48 orders it) lists the outcomes and those three lines; nothing else in the session repeats them.
- B23 As a person running a step by hand, I want the norn skill to still work, shrunk to "run `norn brief` in this worktree and do what it says".
  Example: in a fresh session in a unit worktree, "use the norn skill" leads to `norn brief` and the same work as B20.
- B24 As a step's agent resumed in a later session (fresh-session retry, answer after the session is gone), I want the same one-line first prompt.
  Example: a retry after a died session starts with that line and gets the brief of attempt 2.

- B25 As a step's agent, I want a step's instructions to hold only what is specific to that step; repo-wide prose (the dev-build warning, rule ids) is said once, in AGENTS.md.
  Example: this repo's `implement` brief no longer carries the dev-build warning; AGENTS.md does.

### Clean session profile

- B26 As a person, I want a Claude step session to start with the project's settings, skills and MCP servers only, so that my personal setup does not fill the agent's context.
  Example: a step launched by norn does not load the person's mail, calendar or time-tracking servers or their personal skills; the repo's own MCP servers (from its `.mcp.json`, when there is one) and skills load.
- B27 As a person who wants their own setup in step sessions, I want to override it the way I override agent args today.
  Example: setting `agents.claude.args` in the user config replaces the built-in args, clean profile included.
- B28 Dropped at plan: `norn story chat` gets the clean profile too (it uses the same `agents.claude.args`); a person who wants their setup there overrides the args (B27).

- B29 As a person, I want it said plainly if the clean profile cannot leave something out.
  Example: if the person's user-level CLAUDE.md still loads in a clean session, `docs/limitations.md` says so.

### The handoff as a journal

- B30 As a step's agent or a person, I want `handoffs/<unit>.md` to be the unit's journal, appended by norn, one entry per report.
  Example: `norn done approve --handoff "Checked B1–B12; …"` appends `### review#1 approve · 2026-11-07` followed by that text.
- B31 As a person, I want `ask` and `stuck` to append an entry too.
  Example: `norn ask "Keep the old flag?"` appends `### implement#2 ask · <date>` with the question.
- B32 As a step's agent, I want a person's decisions in the journal in order: a gate ruling with its reason, an answer, a note.
  Example: a person rejects at `ready` with "split the PR" → the journal gets `### ready reject · <date>` with that reason.
- B33 As a person, I want each agent entry kept short, so that the journal stays readable.
  Example: `norn done … --handoff` with 180 words is refused: `--handoff is 180 words; keep it to 150 or fewer.`; nothing is appended.
- B34 As a step's agent, I want not to maintain the handoff myself.
  Example: the brief no longer asks for Goal / Progress / Resume; the agent writes its summary, decisions and next action into `--handoff`.
- B35 As a step's agent, I want the brief to tell me the last entry's next action was written for whoever continues, not as an instruction to me.
  Example: Inputs: `handoffs/_story.md — journal: what earlier steps did and decided, newest last; the last entry's next was written for whoever continues`.
- B36 As a person with a unit started before this ships, I want its existing handoff kept as it is, with new entries appended below it.
  Example: an old Goal / Progress / Resume handoff keeps its text; the next report adds the first `###` entry after it.
- B37 As a person, I want norn to stop writing progress lines into a section of the handoff, so that no second Progress section appears.
  Example: after a reject, the handoff gets one journal entry and no `## Progress` section (#273's duplicate no longer happens).

### AGENTS.md as a map, developer docs on demand

- B38 As a step's agent in this repo, I want AGENTS.md to be a map of 500 words or fewer: what norn is, the layout (each package, its purpose, entry file and tests folder, and the dependency direction), five commands (`bun install`, `bun run test`, `bun run typecheck`, `bun run schema:emit`, `bun run docs:emit`), the hard rules, and one "for X read Y" line per developer doc.
  Example: AGENTS.md has 480 words; "for the test tiers, golden corpus, transcripts, snapshots and port contracts read `docs/dev/testing.md`".
- B39 As a contributor, I want the detail AGENTS.md holds today in `docs/dev/`: `testing.md` (tiers, golden corpus, effect transcripts, observe snapshots, port contracts, test helpers), `contracts.md` (where schemas, ids, ports, facts and decide live, and the invariants), `decisions.md` (deliberate design choices), `process.md` (self-hosting, released binary vs dev build, bypass, workflows, skills, changelog, release) and `gotchas.md`.
  Example: the golden corpus instructions are in `docs/dev/testing.md`, not AGENTS.md.
- B40 As a contributor, I want the docs lint to keep AGENTS.md at 500 words or fewer and to check `docs/dev/` like the rest of the docs.
  Example: AGENTS.md grows to 520 words → `bun run test` fails naming the count; a broken link in `docs/dev/process.md` fails it too.
- B41 As a person setting up norn in another repo, I want `norn init` to give a template for the AGENTS.md map, so that the same idea works anywhere.
  Example: `norn init` in a repo without AGENTS.md writes one with a Layout section to fill in; in a repo that has one, it leaves it untouched.

### Rules file and comments

- B42 As a contributor, I want `.agents/RULES.md` removed, so that there is no second, id-indexed copy of the behaviour to keep in step.
  Example: the file is gone; git history keeps it.
- B43 As a contributor, I want the invariants that must not break stated once, in plain sentences without ids, in `docs/dev/contracts.md`, and pointed at from AGENTS.md's hard rules.
  Example: about ten sentences such as "A receipt is written before its effect, and state.json is written last."
- B44 As a user, I want what norn does for me described in `docs/concepts.md` and `docs/reference.md`; behaviour only RULES.md described either moves there or is dropped.
  Example: every link from the user docs into RULES.md is gone or points into the user docs.
- B45 As a contributor reading code, I want comments that explain why, with no rule, story or review ids.
  Example: a comment reading `gh-195 B25 (D10)` is removed or rewritten as the reason; ids live in `git blame`.
- B46 As a refining agent, I want the refine step to update the user docs a change alters, instead of amending a rules file.
  Example: the refinement brief says "update the user docs your change alters"; no workflow, skill or doc tells an agent to edit RULES.md.
- B47 As a contributor, I want the docs lint to stop checking rule ids, and every reference to RULES.md gone from the repo's docs, workflows and skills.
  Example: `bun run test` passes with no RULES.md; a grep for `RULES.md` outside old spec folders finds nothing.

## Out of scope

- Repo reminders every run accounts for (#201) — its own story.
- The pre-done accounting and keeping a first version of the note to show drift (#200) — its own story.
- Cross-checking a criterion's evidence against what the session ran (#199) — its own story.
- Prompt craft in the implement, review and QA skills (#206) — its own story.
- A clean session profile for codex, opencode and gemini — each needs its own flags; added when someone runs them.
- A generated code map — the hand-written Layout section in AGENTS.md is the map.
- A list of code files per step in the brief — the map replaces it.
- System-prompt injection of the protocol — differs per agent; the brief already carries it.
- Rewriting old handoffs or old spec folders — they stay as written.
- `pr.md` and the issue's triage and reproduce comments — they tell the story for people, outside the step's context.
- Starting the next round behind one gate after triage — its own story (file with `/issue`).
- Shared step definitions across workflows and an overlay of shipped skills and workflows by repo files — its own story (file with `/issue`).
- An index of rules or recalling rules through hooks — the rules file is removed (B42).
- Orientation metrics (former B1–B6) — dropped at plan: more machinery than they would save; the Problem's numbers were measured by hand and can be again.
- The brief pasted as the first prompt — a one-line prompt that runs `norn brief` removes the skill hop without rendering the brief at launch.
- Closing #133 — superseded by B38–B40; the person closes it.

## Open questions

None.

## Plan

Guiding rule for every slice: remove more than you add. The plan adds no new action shape, receipt field, adapter method or command.

### Seams
- **S1 core `renderBrief`, through its `Briefing` (markdown + `BriefJson`).** Observes B7–B18, B22, B34, B35, B48, B49.
  Prior art: `brief.test.ts` (snapshot and field tests over hand-built `BriefInput`), `criteria.test.ts`, `base-sync.test.ts`.
- **S2 the agent protocol through the cli harness** (`createHarness`, `FakeRunner`): the first prompt a launch, fresh retry or resend gets, what `story start --print` prints, and the briefing `norn brief` stores and `run view` shows. Observes B19–B21, B24.
  Prior art: `agent-protocol.test.ts`, `prompts.test.ts` (cli integration and core unit), `story-start.test.ts`; the slice-workflow and recovery effect transcripts.
- **S3 config resolution and the Claude adapter's `launchCommand`.** Observes B26, B27.
  Prior art: `config.test.ts`, `config-runtime.test.ts`, the claude adapter tests under `packages/adapters/test/claude/`.
- **S4 the report and decision commands through the cli harness, observed in the unit's handoff file**: `done`, `ask`, `stuck`, `story approve|reject|answer`. Observes B30–B33, B36, B37.
  Prior art: `handoffs-folder.test.ts`, `story-decision.test.ts`, `agent-protocol.test.ts`.
- **S5 the repo lints** (`test/repo/docs.test.ts` with the doc set in `test/support/docs.ts`; `test/repo/repo.test.ts`). Observes B38, B40, B42, B45, B47.
  Prior art: the rules-file, link and glossary tests in those two files.
- **S6 `norn init` through the cli harness.** Observes B41.
  Prior art: `init-review.test.ts`, `init-version.test.ts`.

### Coverage
| Behaviour | Seam | Test kind | Notes |
|---|---|---|---|
| B1–B6 | — | — | dropped at plan |
| B7 | S1 | unit | first attempt: story and step only |
| B8 | S1 | unit | |
| B9 | S1 | unit | only the counter of the edge taken |
| B10 | S1 | unit | |
| B11 | S1 | unit | each of the three thresholds, and absent otherwise |
| B12 | S1 | unit | a huge handoff in the input leaves the markdown small |
| B13 | S1 | unit | |
| B14 | S1 | unit | no log text in the markdown |
| B15 | S1 | unit | answer, note, ruling quoted |
| B16 | S1 | unit | |
| B17 | S1 | unit | no code paths under Inputs |
| B18 | S1 | unit | `BriefJson` keeps every field it has today |
| B19 | S2 | integration | stored briefing equals the printed markdown |
| B20 | S2 | integration | `FakeRunner` launch prompt |
| B21 | S2 | integration | `story start --print` |
| B22 | S1 | unit | plus review: the norn skill and workflows no longer repeat it |
| B23 | — | review + QA | norn skill text (`packages/cli/assets/skills/norn`); QA: fresh session in a unit worktree |
| B24 | S2 | integration | fresh retry and resend use the same line |
| B25 | — | review | instructions in `.agents/workflows/` and the shipped copies |
| B26 | S3 | unit | built-in args; what a real session loads is QA by a person |
| B27 | S3 | unit | user `args` replace the list |
| B28 | — | — | dropped at plan |
| B29 | — | review + QA | `docs/limitations.md` names whatever QA finds still loading |
| B30 | S4 | integration | |
| B31 | S4 | integration | |
| B32 | S4 | integration | reject with reason, answer |
| B33 | S4 | integration | refusal, nothing appended, no receipt |
| B34 | S1 | unit | plus review of the norn skill and workflow texts |
| B35 | S1 | unit | |
| B36 | S4 | integration | old Goal/Progress/Resume handoff kept, entry below |
| B37 | S4 | integration | reject writes one entry, no `## Progress` |
| B38 | S5 | unit (lint) | word cap; content by review |
| B39 | — | review | the five `docs/dev/` files |
| B40 | S5 | unit (lint) | |
| B41 | S6 | integration | writes when absent, leaves an existing one |
| B42 | S5 | unit (lint) | |
| B43 | — | review | |
| B44 | S5 | unit (lint) | no link into RULES.md; where the content went, review |
| B45 | S5 | unit (lint) | new lint: no rule, story or review id in a package source comment or printed string |
| B46 | — | review | refinement workflow (both copies) and refine skill |
| B47 | S5 | unit (lint) | |
| B48 | S1 | unit | section order |
| B49 | S1 | unit | |

### Prefactoring
None. Handoff writes already go through one place (the report runtime's `appendProgress` / `receiptsWritten`); the journal replaces it there.

### Implementation decisions
- D1 One first prompt everywhere: `AUTO_PROMPT` becomes ``Run `norn brief` in this worktree and do what it says.``, used by the auto launch, the fresh retry, the launch-prompt resend and `startCommandFor` (story start). A string change only: no new action shape, the agent's `norn brief` still starts a manual run (MO3 unchanged). The golden corpus is re-decided (`bun run golden -- --update`) and the slice-workflow and recovery transcripts rewritten for the new string. `NUDGE_TEXT` stays.
- D2 Only the markdown is trimmed. `BriefJson` keeps every field it has today (B18), the handoff text included; inputs gain a `description` beside `ref`. The `norn brief` command stops reading the failing check's log text and the handoff body for the markdown; evidence folders are counted, not listed.
- D3 The generic descriptions (B12, B35, B49) are one fixed table in the brief module keyed by input kind (story spec, slice file, handoff journal, diff, findings, check log, evidence folder, record). No per-file reading.
- D4 Limits show only when close (B11): on the last fresh-session retry, with one nudge or none left, or with under 20% of the deadline left; one line each.
- D5 Journal entry format: a heading `### <step>#<attempt> <outcome> · <YYYY-MM-DD>` for a report (`ask` and `stuck` as the outcome word, their question or reason as the text), `### <step> <approve|reject> · <date>` for a gate ruling with its reason, `### answer · <date>` with question and answer, then the text. Written by the command that writes the receipt, right after it (P6), in the report runtime; it replaces `appendProgress`, the reject progress line, `HANDOFF_SKELETON` and `tidyHandoff`. start_run no longer creates a skeleton handoff; the first entry creates the file. An existing handoff is appended to, never rewritten (B36).
- D6 The 150-word cap (B33) counts whitespace-separated words of `--handoff`; over it, `done` refuses with code `handoff_too_long` before any receipt is written.
- D7 Clean profile: the built-in `agents.claude.args` gain the Claude flags that restrict settings to project and local sources (`--setting-sources project,local`) beside `--permission-mode auto`. It applies to every Claude launch, `story chat` included (B28 dropped). If the spike (Risks) shows user MCP servers or claude.ai connectors still load, the Claude adapter's `launchCommand` adds strict MCP config with the repo's `.mcp.json` when one exists; what still loads after that goes into `docs/limitations.md` (B29).
- D8 AGENTS.md map: the docs lint counts whitespace-separated words of the whole file (cap 500); `docs/dev/*.md` join the doc set (links, anchors, commands, glossary). The rule-id tests and the pinned id list go.
- D9 RULES.md removal: the file is deleted; its about ten invariants are rewritten as plain sentences in `docs/dev/contracts.md`; user-facing behaviour only it described moves to `docs/concepts.md` / `docs/reference.md` or is dropped; every reference to it (CONTRIBUTING, REVIEW.md, the triage and refinement workflows in both places, the issue skill, docs/concepts) is removed or repointed. Refinement's instructions say "update the user docs your change alters".
- D10 Ids out of code (B45): one scripted pass strips rule, story and review ids from package source comments and printed strings (refusal and noop texts like `(K1)` point at a file that no longer exists); a comment left with no words is deleted or rewritten as the reason by hand. Test names keep their ids. Schema descriptions change, so `bun run schema:emit` and `bun run docs:emit` run with it, and decide reasons change, so the golden corpus is re-decided in the same slice. A new lint in `repo.test.ts` fails on an id in a package source comment or string literal.
- D11 The norn skill (source in `packages/cli/assets/skills/norn`, copy rewritten by init) shrinks to "run `norn brief` in this worktree and do what it says", plus the four commands it may run. Repo-wide prose moves out of `.agents/workflows/` instructions into AGENTS.md (B25); shipped workflows change in both places.

### Testing decisions
A good test drives a seam from outside: S1 builds a `BriefInput` and reads the markdown and JSON; S2, S4 and S6 run CLI commands in the harness and read what a person or agent would see (printed output, the `FakeRunner`'s prompt, the handoff file on disk); S3 reads resolved config and the argv. No test reads the brief module's helpers or the report runtime's internals. Faked: only the system boundaries the harness already fakes (runner, remote, notifier, clock). Lints are unit tier. What a real Claude session loads (B26, B29) and the norn skill working in a fresh session (B23) are QA by a person; no test starts a real agent.

### Risks
- Claude's flags may not drop everything (B26): user skills, user CLAUDE.md, claude.ai connectors and user-scope MCP servers each come from a different place. A spike in the profile slice launches one session with the flags and lists what loaded before D7 is built; whatever cannot be dropped is documented (B29).
- `--setting-sources project,local` could also drop something a step needs from user settings (auth, a model alias); the same spike checks a step still runs.
- D10 is the largest diff of the story (about 4,800 id mentions in 201 files) and touches goldens, schemas and the generated reference at once; it goes in its own slice, after RULES.md is gone, so a conflict with other open stories is resolved once.
- The golden corpus and effect transcripts change twice (D1, D10); each slice re-decides them and the diff is reviewed as the whole behaviour change.
