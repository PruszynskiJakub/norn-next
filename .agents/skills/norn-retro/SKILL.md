---
name: norn-retro
description: Runs a retrospective on one finished story from its delivery record and suggests one change per friction found, each with its evidence, and a line for each gate ruling that reads as a lasting preference, in the reply; changes no file. Use when a person asks for a retro or retrospective on a story, usually after its pull request merges.
---

# Retro

A person asks for this after a story's pull request merges. You read what the delivery left behind, find where it cost time, and suggest how to make the next story cheaper. You suggest; the person decides what to apply. You write no file and change nothing: the suggestions are your reply.

## 1. Read the record

The person names the story by its key, such as `gh-123`. Ask if they did not. Read only: never edit the record, and run no command that changes the repository, the remote or norn's run data. `norn story view`, `norn status`, `norn story list` and `norn config get` only read; every other `norn` verb acts, so run none of them. Fetching the record's objects without writing a ref is reading.

**Start from the views.** Run these from the story's repository:

- `norn story view <key>` (add `--json` for the fields): each unit with its step, attempt, workflow, how it ended (`ended`, `ended_reason`) and what it waits for, the change and its state, and who took the claim or updated the branch.
- `norn config get store.use`: where the record is kept, `local` (this machine's files) or `refs` (git refs shared through the remote).

The views summarize; the receipts behind them are the evidence. Read those next.

**Where the record is.** Each unit of the story (the story's own unit, and one per slice: `<key>/01`, `<key>/02`, …) has a `state.json` and a folder of receipts. The story's documents are kept beside them as artifacts, never in the repository: the `.agents/specs/<key>/` folder agents worked in existed only in the unit's worktree, which is gone once the story finished.

- **Store `local`**: in the machine dir of the checkout that ran the story, `~/.norn/repos/<checkout folder name>-<8 hex>/` (under `$NORN_HOME_DIR/repos/` when that is set). Find it with `ls -d ~/.norn/repos/<checkout folder name>-*/` and keep the one holding `runs-v2/stories/<key>/`. In that story folder:
  - `units/story/` is the story's own unit, `units/<nn>/` each slice;
  - each unit folder holds `state.json` and `receipts/<seq>-<id>.json`, the seq zero-padded to 8 digits;
  - `artifacts/` holds the documents, one flat file each, its path percent-encoded (`/` is `%2f`, an uppercase letter is `!` and the letter): `spec.md`, `handoffs%2f<key>.md`, `handoffs%2f<key>-<nn>.md`, `slices%2f<nn>-<slug>.md`;
  - `claim.json` says which machine holds the story now (`claim: null` once it finished).
- **Store `refs`**: one ref per story, `refs/norn/v2/runs/<key>`. In a clone where norn ran, read it in place: `git ls-tree -r --name-only refs/norn/v2/runs/<key>`, `git show refs/norn/v2/runs/<key>:<path>`. In any other clone, find its sha with `git ls-remote origin refs/norn/v2/runs/<key>`, fetch its objects with `git fetch --no-tags --no-write-fetch-head origin refs/norn/v2/runs/<key>` (no `:<ref>`: that would write a ref norn keeps as its own), then read by that sha. In its tree:
  - `units/<key>/` is the story's own unit, `units/<key>/<nn>/` each slice;
  - each holds `state.json` and `receipts/<seq>-<id>.json` (seq not padded);
  - `artifacts/<path>` holds the documents under their plain paths: `artifacts/spec.md`, `artifacts/handoffs/<key>.md`, `artifacts/slices/<nn>-<slug>.md`.

**The documents.**

- **The spec**, `spec.md`: the tracker item mirrored at the top, then what refinement and planning wrote below it (User Stories, Plan; a review step may have added its verdict). Each slice file `slices/<nn>-<slug>.md` has its acceptance and frontmatter `criteria` with `id` and `verifier`.
- **The handoffs**, `handoffs/<key>.md` for the story's unit and `handoffs/<key>-<nn>.md` for each slice: the unit's state when it ended (State, with the review's traceability table, and Notes with what was tried and failed). When an agent kept its findings or a review verdict there rather than in its report, this is the only place they are.

**Each unit's record.** Every file is JSON. `state.json` is `{version, data}`; a receipt is `{seq, id, at, data}`, and its kind is `data.kind`. Find a receipt by its kind, never by its file name: the name is the seq and an id, which only sometimes reads as a word.

- `state.json` → `data`: `workflow` (`name`, `hash`, and `doc`: the definition this unit ran, pinned when its round began; `doc.counters` gives each counter's `max`, and each outcome with a `counter` is a loop), `step`, `attempt`, `counters` (name: times its loop was taken), `visits` (step name: entries), `retries_used`, `ended` (`done`, `stuck` or `corrupt`) with `ended_reason`, `exhausted` (the counter that ran out), and `parked` while it waits for a person.
- `receipts/`, in the order they happened. Each names the `step` and `attempt` it was written for. By `data.kind`:
  - `round.started`: a round began on `workflow` (its `name`), at step `at` when not its start; `by` and `reason` when a person started it. A unit with two of these ran two rounds: split the receipts at each one.
  - `run.started`: `run_id`, `run_kind` (`agent`, `check` or `step`), `executor` (the agent's executor, `check`, or the step kind's name), `attended`; `retry_of` names the run a fresh session replaced; `session` once the session is known. An agent run is recorded twice, the second time with its `session`: count runs by `run_id`, not by receipt.
  - `run.reported`: the agent's report, `verb` `done`, `ask` or `stuck`, with `outcome` (for `done`) and `text`: the note of a `done`, the question of an `ask`, the reason of a `stuck`. `findings`, when present, are the findings a `done` handed back (`--findings`), each with `severity` and `title`; a step whose outcome hands findings back (`hand_back` in the step's definition) gives them there or in its note. `criteria`, when present, is the criteria report: one entry per criterion with `id` and `verdict` (`pass` with `evidence`, `fail` with `repro`, `person` with `how`, `unverified` with `reason` and `how`), and a verdict's `note` for a person. `notes` lists those notes for a person.
  - `answer.sent`: a person's answer to an `ask` or a permission prompt (`input_id`, `text`, `by`).
  - `gate.decided`: a ruling at a gate, `outcome` `approve` or `reject`, `by`, `reason` (the person's words); a `reason` that starts `fsd:` (or `delegated: true` on older records) is a supervisor agent's ruling on the person's behalf (`norn-fsd-round`): count those apart from the person's own. It follows a `unit.parked` with `reason` `gate.park`.
  - `unit.parked`: the unit waited for a person; `reason` names the rule (`gate.park`, `agent.permission.park`, …).
  - `check.finished`: `exit` and `outcome` of a check; `step.finished`: `step_kind`, `outcome` and any `detail` of a plugin step such as `update-branch` or `open-pr`.
  - `run.classified`: how a run ended, judged from the session rather than reported: `outcome` `silent`, `died`, `timeout`, `stalled`, `ask` or `stuck`, with the `rule` that judged it and the `error` the last turn stopped on. `run.ended`: a run that ended without a report (`reason` `exit`, `killed`, `crash`, `stopped`, `timeout`).
  - `nudge.sent` (`reason`): norn nudged a quiet session. `stop.sent`: norn stopped a run past its deadline. `run.resumed`: a check or step run again after it was cut short. `run.limited` (`resets_at`): the session hit a usage limit.
  - `step.moved`: a person sent the unit to step `to` by hand (`norn run rerun`), with the counters in `reset` back to 0, `by` and `reason`. `run.requested`: a person started a step manual mode held. `mode.changed`: `mode`, `by`.
  - `claim.taken` (`from`, `to`, `by`, `reason`): a person moved the story to another machine. `branch.update` then `branch.updated` (`base`, `base_sha`, `merged`, `head`, `pushed`, `by`): a person brought a finished story's branch up to date with its base.
  - `unit.marked`: how the unit ended (`ended`, `reason`). `receipt.rejected` (`seq`, `reason`): a receipt norn refused to apply.

**What the machine keeps beside the record**, only on the machine that ran the story and only for a while. When a part is missing, say so in the report and work from the record alone. In the machine dir:

- `trace-v2/<tick_id>.json`: one file per tick, kept for `trace.retain` (7 days when `norn config get trace.retain` says it is not set; `keep` keeps them all), so a story finished longer ago has none. Each has `at`, `decisions` (`kind`, `unit`, `rule`, and `story` for claim actions), `outcomes` (each `decision` with `ok`, and `error` when it failed) and `problems`. Keep the ticks whose decisions name this story's units. A failed outcome and a `problems` line are friction; a run of `noop` decisions with one rule over many ticks is how long a unit waited.
- `runtime/step-runs/<unit>.json`, with the unit's `/` written as `-` (`lt-1-01.json` for slice 01 of `lt-1`; the same in the folders below): the unit's last check or step run, with `exit`, `outcome` and the end of its `output`.
- Hook events (`events-v2/<unit>/<run_id>/events/*.json`: the session's normalized events, with `tool.permission` for a permission prompt, `input.requested` for a question, `turn.ended` with the agent's `last_message`), session logs (`runtime/sessions/<run_id>.log`) and check logs (`runtime/check-logs/<unit>/<run_id>-<n>.log`) are removed when the story finishes. They are there only for a story still open or stuck; for a finished one, the record and the handoffs are all there is.

## 2. Find the friction

Go through every unit and every round. For each finding, keep the evidence as you go: the unit, the receipt's seq and kind (`gh-123/02 #14 gate.decided reject`), the document, or the trace file.

1. **Counters that ran high or ran out.** `counters` in `state.json` against `max` in its pinned `workflow.doc.counters`; an `exhausted` counter; a `step.moved` with `reset`. Read what sent the work back each time (the `run.reported` text and criteria, the `gate.decided` reason, the `check.finished` and the check's output between loops). One cause behind most loops is the finding, not the count.
2. **Repeated rejects.** Two or more `gate.decided` `reject` at the same gate, or rejects in different slices whose `reason` says the same thing.
3. **Stuck and lost sessions.** `run.reported` with `verb: "stuck"` and its text; a unit that `ended` `stuck` and its `ended_reason`; `run.classified` with `died`, `silent`, `stalled` or `timeout`; `run.started` with `retry_of`; several `nudge.sent` in one run; a `step.moved` or a `round.started` with `by` where a person stepped in by hand; a `claim.taken`. Read the `error` of a classification and the handoff's Notes for why.
4. **Asks a better spec or skill would have answered.** Pair each `run.reported` with `verb: "ask"` with the `answer.sent` after it. Would the spec, the plan, the contributor docs or a skill have held that answer? A `unit.parked` with `agent.permission.park` was a permission prompt: name the command when the hook events still show its `tool.permission`, or the answer otherwise.
5. **Criteria a machine could not check.** `unverified` verdicts in a criteria report and their `reason`: a missing capability. `person` verdicts on criteria an agent could check given a tool, a seed script or a fixture.
6. **Checks that failed for environment reasons**, not code: `exit` 126 or 127, a check stopped at its `timeout`, a service not running, a port in use, a missing secret or remote, or a flaky test that passed on the next run with no change in between. Read the check's output where it is still kept, and the text of the report that followed.
7. **Review findings that recur.** The same point across slices' review reports (their `run.reported` findings or text, or the handoff where the reviewer wrote them), or found again after rework.

Rank the findings by what they cost: a person pulled in to unblock or redo work, then a rework loop, then a lost session, then a wait for an answer, then a manual check a machine could have made. A finding that recurs across slices outranks a one-off. Leave out what went smoothly.

## 3. Propose lasting preferences

A person's ruling at a gate sometimes says how they want every story done, not only this one. Gather those so the next story starts with them.

1. **List the gate rulings.** Every `gate.decided` in the record whose `reason` is not empty, each with the gate (its `step`), the round and unit, and the person's words, quoted. When its `reason` starts `fsd:` (or it carries `delegated: true`, on older records), mark it supervised: a supervisor agent wrote it, not the person. Give your reading of each (lasting, or about this story only) and ask the person which read as a lasting preference. A supervised ruling is the supervisor's reading, so treat it as lasting only when the person says so. With no ruling that has a reason, say so in one line and propose nothing.
2. **Pick the file by what the ruling is about.** A ruling on how code is judged (what fails review, what not to report, what to ignore) belongs in `REVIEW.md` at the repo root, which review reads. A ruling on how agents work (how to build, test, name things, ask, hand back) belongs in the repo's agent instructions file: `AGENTS.md`, else `CLAUDE.md`.
3. **Read the target file first.** When it already states the preference, cite that line as evidence and never propose a duplicate; when it states it differently, propose the change to that line. When the file is missing, propose creating it with that line, and say the file is new.
4. **Propose one line per lasting ruling**, naming the **File**, the **Section** it goes under (an existing heading, or a new one), the **Wording** (the line ready to paste) and the **Ruling** it comes from (its unit, seq and gate, and the words quoted).

## 4. Suggest one change per finding

For each finding, suggest ONE concrete change, small enough to review in a minute: the exact rule text, key and value, or check command. Name the file it touches:

| File | When |
|---|---|
| a skill, `.agents/skills/<name>/SKILL.md` | an agent's craft fell short the same way more than once |
| a workflow, `.agents/workflows/<name>.yaml` | a missing check before review (lint, type check), a counter's `max`, a check's command or `timeout`, a step's `deadline`, `nudges`, `retries` or executor (`by`), what an outcome hands back |
| a workflow's `defaults:`, or the norn config | the limits (`deadline`, `nudges`, `retries`, `stalled`) for every step of a workflow; an executor's `model` or `args` under `executors` in the person's config |
| contributor docs: `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, coding standards | a repo fact an agent asked for or got wrong; a judgement call review kept finding |
| the spec template: `SKILL.md` and `EXAMPLE.md` of the refine skill, `norn-refine` | asks and rejects that trace back to a gap in how specs are written |

Choose where the change belongs:

- **A mechanical mistake gets an automated check, not prose.** A fixed pattern, a banned API, an import shape or a file-location rule belongs in the repo's linter, a pre-commit hook or a check before review. Prose rules are for judgement calls.
- **Standards belong to review.** The implementing agent carries the most context; the reviewing agent gets a diff. Put a rule a reviewer can enforce where review reads it.
- **Contributor docs load into every agent.** Add a pointer to a doc, not the doc itself.
- **A capability gap is fixed where it lives**: give the agent the tool (a browser MCP, a device), or send those criteria to a person.
- **A tight counter is rarely the fix.** Fix what caused the loops; raise a `max` only when the loops were each worth it.
- **Look for what exists first**: a check that is defined but not wired, a doc that already says it but no agent reads.
- **norn's own skills and workflows come from its pack.** It writes each pack skill into a worktree's `.agents/skills/<name>/` before every launch and ignores it in git, and leaves a skill of that name the repo committed alone. So a change to a pack skill is a repo copy: commit `.agents/skills/<name>/SKILL.md`, starting from the pack's text, and it replaces the pack's skill from then on. A workflow works the same way: a repo file under `.agents/workflows/` replaces the pack's file of the same name whole. A skill or workflow the repo wrote itself changes in place. When the contributor docs say `.agents/skills/` holds generated copies of a source elsewhere in the repo, name that source instead.

Never suggest a change without evidence in the record, and never two changes for one finding: pick the one that removes the cause.

## 5. Give the suggestions

Answer the person in this shape. Do not write it to a file, and do not apply any change, even one that looks obvious: they decide what to apply, and may ask you to afterwards. Cite a receipt by its unit, seq and kind, a document by its artifact path (`handoffs/gh-123-02.md`), and a trace by its file name. Quote evidence briefly and write `<REDACTED>` for any secret.

```markdown
# Retro: <key> <title>

Read: the <local | refs> record of <key> (<n> rounds, <n> slices). Trace: <present, from <date> to <date> | not on this machine | aged out>. Logs: <present | removed when the story finished>.

## Summary

<Two or three lines: what cost the most, and the change that would save the most.>

## Findings

### 1. <The friction, in one line>

- **Cost**: <loops taken, times a person stepped in, sessions lost, time waited>
- **Evidence**: `gh-123/02 #14 gate.decided reject` (reason: "…"), `gh-123/03 #9 gate.decided reject`, `handoffs/gh-123-02.md` (Notes: "…")
- **Change**: <the one change: rule text, key and value, or command>
- **File**: `<path>`

### 2. …

## Lasting preferences

Gate rulings (which read as a lasting preference? my reading after each):

- `gh-123 #12 gate.decided reject`, gate `<step>`, round 1: "…" (lasting)
- `gh-123/02 #21 gate.decided approve`, gate `<step>`, supervised: "fsd: …" (this story only)

### 1. <The preference, in one line>

- **File**: `REVIEW.md` (new file: propose creating it) | `AGENTS.md` (else `CLAUDE.md`)
- **Section**: <an existing heading, or a new one>
- **Wording**: <the line, ready to paste>
- **Ruling**: `gh-123 #12 gate.decided reject` ("…")

<Or, when the file already says it: **Already stated**: `AGENTS.md`, section <heading>: "<the line>", cited as evidence; no new line.>

## Went well

<One or two lines, or leave the section out.>
```

Done when every unit's record is read, every finding in your reply has its evidence and one change with its file, every gate ruling with a reason is listed with a proposal or a cited line for each one read as lasting, and the working tree is exactly as you found it.
