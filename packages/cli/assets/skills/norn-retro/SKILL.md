---
name: norn-retro
description: Runs a retrospective on one finished story from its delivery record and suggests one change per friction found, each with its evidence, in the reply; changes no file. Use when a person asks for a retro or retrospective on a story, usually after its pull request merges.
---

# Retro

A person asks for this after a story's pull request merges. You read what the delivery left behind, find where it cost time, and suggest how to make the next story cheaper. You suggest; the person decides what to apply. You write no file and change nothing: the suggestions are your reply.

## 1. Read the record

The person names the story: a key such as `gh-123`, or its folder `.agents/specs/<key>-<slug>/`. Ask if they did not. Read only: never edit the delivery record, and run no command that changes the repository or the remote (fetching the record's objects without writing a local ref is reading).

- **The spec**: `spec.md` (User Stories, Plan) and each `slices/<nn>-<slug>.md` (acceptance, frontmatter `criteria` with `id` and `verifier`).
- **The handoffs**: `handoffs/_story.md` for the story and `handoffs/<nn>-<slug>.md` for each slice in the spec folder: the unit's state when it ended (Goal, Proof, Easy to miss, Not proven yet, Notes with what was tried and failed, Resume; an older handoff has Goal, Progress and Resume).
- **The delivery record**: one commit on a ref of its own on the remote, named after the story and ending in `runs/<key>`, which no clone carries. Find it and its sha with `git ls-remote origin "refs/*/runs/<key>"`, fetch its objects with `git fetch --no-tags origin <ref>` (no `:<ref>`: that would write a local ref the delivery tool keeps as its own), then read it by that sha: `git ls-tree -r --name-only <sha>`, `git show <sha>:<path>`. Never read `FETCH_HEAD`: the tool's background sync fetches too and overwrites it. On the machine that ran the story, the same folders may also be in the tool's folder for this checkout, `ls -d ~/.*/repos/<checkout folder name>-*/`, under `runs/<key>/`. The record holds one folder per unit: `_story/rounds/<NN>-<workflow>/` for each round of the story and `<nn>-<slug>/` for each slice. A record archived from an older version may lack `rounds/` (the story's state directly under `_story/`, read it as one round) and may still hold a `handoff.md` per unit; a story finished by an older version may still have it in the spec folder, under `runs/`. In each unit folder:
  - `state.json`: `counters` (name: times its loop was taken), `visits` (stage name: entries), `attempt`, `status`, `park` (`kind`, `reason`), `nudges_used`, `retries_used`.
  - `workflow.yaml`: the definition this unit ran, pinned when it began. Its `counters` give each `max`; each edge with a `counter` is a loop.
  - `receipts/NNNN-<kind>.json`: numbered reports in the order they happened, each with `step`, `attempt`, `at` and `by`. By `kind`:
    - `done`: `outcome`, `handoff` (the agent's summary), `findings` (`severity`, `title`, `file`, `criterion`, `detail`), `criteria` (one `verdict` per criterion: `pass`, `fail`, `person` or `unverified`, with `reason` and `how`), `notes`;
    - `ask` (`question`, `options`; `implicit: true` with `command` when it was a permission prompt), then its `answer` (`answer`, `ask_receipt_id`);
    - `stuck` (`reason`) and the person's `unstick` (`to`, `reset`, `comment`);
    - `approve` and `reject` at a gate, with the person's `comment`;
    - `check`: `command`, `exit_code`, `duration_ms`, `reason: "timeout"`, `output_tail`, `log`;
    - `started`: `agent`, `model`, `retry: true` for a fresh session after one was lost;
    - `classify`: how a stage ended, judged from facts rather than reported. `outcome` is `silent`, `died`, `timeout`, `stalled`, `conflict`, `stale` or `exhausted`, with `rule`, `detail`, `route` and `counter` (`name`, `value`, `max`); `snapshot.last_message` is what the agent said last before it went quiet;
    - `update` (`from`, `to`): a person moved the work to another stage by hand; `round` with `forced: true` (`left_at`, `comment`): a person ended a round unfinished; `take` (`forced`, `expired`, `record_lost`): another machine took the story over.

    A `delegated: true` on an `approve`, `reject`, `answer` or `unstick` means a supervisor agent decided on the person's behalf: count those apart from the person's own.
  - `logs/<run_id>.log`: the full output of a failed check.
  - `evidence/<run_id>/`: what QA saw.
- **The local trace**, only on the machine that ran the story: `<YYYY-MM-DD>.jsonl` files (one per UTC day) at the top of that same folder, one JSON object per line. It is not committed; when it is missing, say so in the report and work from the record alone. Keep the lines whose `unit` (or `fact.story`, `fact.slice`) is this story or one of its slices. By `type`:
  - `hook` with `fact.event: "permission_prompt"` and `fact.command`: commands that stopped for a permission prompt;
  - `reject` (`reason`): a report the tool refused;
  - `criteria` (`verdicts`): criteria reports, counted per verdict;
  - `tick` (`decisions[].rule`, `decisions[].result.ok`, `decisions[].result.error`): actions that failed.

  Next to the day files, `briefings/<run_id>/` holds what each agent was told and `transcripts/<run_id>/` what it said last.

## 2. Find the friction

Go through every unit. For each finding, keep the evidence as you go: the file and its number (`02-invite-form/receipts/0014-reject.json`), or the trace file and line.

1. **Counters that ran high or ran out.** `counters` in `state.json` against `max` in the pinned `workflow.yaml`; a `classify` with `outcome: "exhausted"`; an `unstick` with `reset`. Read what sent the work back each time (the `findings`, the `reject` comment, the `check` output between loops). One cause behind most loops is the finding, not the count.
2. **Repeated rejects.** Two or more `reject` at the same gate, or rejects in different slices whose `comment` says the same thing.
3. **Stuck and lost sessions.** `stuck` reasons; `classify` with `died`, `silent`, `stalled` or `timeout`; `started` with `retry: true`; a high `nudges_used`; an `update` or a forced `round` where a person stepped in by hand; a `take`. Read `snapshot.last_message` and the handoff's Notes (Progress in an older one) for why.
4. **Asks a better spec or skill would have answered.** Pair each `ask` with its `answer`. Would the spec, the plan, the contributor docs or a skill have held that answer? An implicit `ask` with a `command` is a permission prompt: name the command.
5. **Criteria a machine could not check.** `unverified` verdicts and their `reason`: a missing capability. `person` verdicts on criteria an agent could check given a tool, a seed script or a fixture.
6. **Checks that failed for environment reasons**, not code: `exit_code` 126 or 127, `reason: "timeout"`, a service not running, a port in use, a missing secret, or a flaky test that passed on the next run with no change in between. Read `output_tail` and the `log`.
7. **Review findings that recur.** The same `title`, file or rule across slices' `findings`, or found again after rework.

Rank the findings by what they cost: a person pulled in to unblock or redo work, then a rework loop, then a lost session, then a wait for an answer, then a manual check a machine could have made. A finding that recurs across slices outranks a one-off. Leave out what went smoothly.

## 3. Suggest one change per finding

For each finding, suggest ONE concrete change, small enough to review in a minute: the exact rule text, key and value, or check command. Name the file it touches:

| File | When |
|---|---|
| a skill, `.agents/skills/<name>/SKILL.md` | an agent's craft fell short the same way more than once |
| a definition, `.agents/workflows/<name>.yaml` | a missing check before review (lint, type check), a counter `max`, a check's `run` or `timeout`, a stage's `deadline` or `agent`, where a verdict goes |
| a definition's `defaults:`, or the person's own config | the limits (`deadline`, `stalled`, `nudges`, `retries`) in the definition; an agent's `model` or `args` in the person's config |
| contributor docs: `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, coding standards | a repo fact an agent asked for or got wrong; a judgement call review kept finding |
| the spec template: the refine skill's `SKILL.md` and `EXAMPLE.md` in `.agents/skills/norn-refine/` | asks and rejects that trace back to a gap in how specs are written |

Choose where the change belongs:

- **A mechanical mistake gets an automated check, not prose.** A fixed pattern, a banned API, an import shape or a file-location rule belongs in the repo's linter, a pre-commit hook or a check before review. Prose rules are for judgement calls.
- **Standards belong to review.** The implementing agent carries the most context; the reviewing agent gets a diff. Put a rule a reviewer can enforce where review reads it.
- **Contributor docs load into every agent.** Add a pointer to a doc, not the doc itself.
- **A capability gap is fixed where it lives**: give the agent the tool (a browser MCP, a device), or send those criteria to a person.
- **A tight counter is rarely the fix.** Fix what caused the loops; raise a `max` only when the loops were each worth it.
- **Look for what exists first**: a check that is defined but not wired, a doc that already says it but no agent reads.
- **Bundled skills are not edited in place.** The skills in `.agents/skills/` that came with the delivery tool are rewritten by its next upgrade, and a changed copy is reported as drifted. To change one, suggest a copy under a new name, plus the `skill:` line in `.agents/workflows/<name>.yaml` that points at the copy. A skill the repo wrote itself changes in place. When the contributor docs say `.agents/skills/` holds generated copies of a source elsewhere in the repo, name that source instead.

Never suggest a change without evidence in the record, and never two changes for one finding: pick the one that removes the cause.

## 4. Give the suggestions

Answer the person in this shape. Do not write it to a file, and do not apply any change, even one that looks obvious: they decide what to apply, and may ask you to afterwards. Cite a record file by its path in the record and a handoff by its path under the story's folder `.agents/specs/<key>-<slug>/`. Quote evidence briefly and write `<REDACTED>` for any secret.

```markdown
# Retro: <key> <title>

Read: the record ref of <key> (<n> rounds, <n> slices). Trace: <present, dates | not on this machine>.

## Summary

<Two or three lines: what cost the most, and the change that would save the most.>

## Findings

### 1. <The friction, in one line>

- **Cost**: <loops taken, times a person stepped in, sessions lost, time waited>
- **Evidence**: `02-invite-form/receipts/0014-reject.json` (comment: "…"), `03-invite-list/receipts/0009-reject.json`
- **Change**: <the one change: rule text, key and value, or command>
- **File**: `<path>`

### 2. …

## Went well

<One or two lines, or leave the section out.>
```

Done when every unit's record is read and every finding in your reply has its evidence and one change with its file, and the working tree is exactly as you found it.
